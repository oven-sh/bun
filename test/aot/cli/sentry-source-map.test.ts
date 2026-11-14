// docs/compiler/debugging.mdx, "Use with Sentry": an executable built with --minify --sourcemap=external reports errors through
// the @sentry/bun SDK, and the map beside the executable leads from the event back to the sources. Nothing is sent: the transport
// prints the envelopes. Nothing is installed: the package in the temporary folder stands for the SDK and reads stacks and debug IDs
// as @sentry/core and @sentry/node do. An executable without an external map reports the paths of its sources. Either way the SDK
// counts a frame of the program as "in app".
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SourceMapConsumer } from "source-map";
import { built, slot, spawned } from "../harness/commands";
import { bytesAndStoredStrings } from "../harness/executable-bytes";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;
const frameFile = "./compiled.js";

const sdk = {
  "node_modules/@sentry/bun/package.json": JSON.stringify({
    name: "@sentry/bun",
    version: "0.0.0",
    main: "index.js",
    types: "index.d.ts",
  }),
  "node_modules/@sentry/bun/index.d.ts": `export interface Request { body: string | Uint8Array }
export interface Transport { send(envelope: string): Promise<unknown>; flush(timeout: number): Promise<boolean> }
export function createTransport(options: object, send: (request: Request) => Promise<{ statusCode: number }>): Transport;
export function init(options: { dsn: string; transport: (options: object) => Transport }): void;
export function captureException(error: unknown): string;
export function flush(timeout?: number): Promise<boolean>;
`,
  // nodeStackLineParser() and filenameIsInApp() of @sentry/core, its getFilenameToDebugIdMap(), and the two integrations of @sentry/node.
  "node_modules/@sentry/bun/index.js": `let transport;
const isInApp = (file, isNative) => {
  const isInternal = isNative || (file && !file.startsWith("/") && !/^[A-Z]:/.test(file) && !file.startsWith(".") && !/^[a-zA-Z]([a-zA-Z0-9.\\-+])*:\\/\\//.test(file));
  return !isInternal && file !== undefined && !file.includes("node_modules/");
};
const parseLine = line => {
  const match = /^\\s*[-]{4,}$/.test(line) ? null : /at (?:async )?(?:(.+?)\\s+\\()?(?:(.+):(\\d+):(\\d+)?|([^)]+))\\)?/.exec(line);
  if (!match) return undefined;
  let file = match[2]?.startsWith("file://") ? match[2].slice(7) : match[2];
  const isNative = match[5] === "native";
  if (file && /\\/[A-Z]:/.test(file)) file = file.slice(1);
  if (!file && match[5] && !isNative) file = match[5];
  return {
    filename: file && decodeURI(file),
    function: match[1] || "?",
    lineno: match[3] && Number(match[3]),
    colno: match[4] && Number(match[4]),
    in_app: isInApp(file || "", isNative),
  };
};
const parseStack = stack => stack.split("\\n").map(parseLine).filter(Boolean).reverse();
const imagesOf = frames => {
  const files = new Map();
  for (const [stack, id] of Object.entries(globalThis._sentryDebugIds ?? {})) {
    const named = parseStack(stack).findLast(frame => frame.filename);
    if (named) files.set(named.filename, id);
  }
  const images = [];
  for (const file of new Set(frames.map(frame => frame.filename))) {
    if (files.has(file)) images.push({ type: "sourcemap", code_file: file, debug_id: files.get(file) });
  }
  return images;
};
const capture = (error, mechanism) => {
  const frames = parseStack(error.stack ?? "");
  const images = imagesOf(frames);
  const event = {
    exception: { values: [{ type: error.name, value: error.message, mechanism, stacktrace: { frames } }] },
    ...(images.length && { debug_meta: { images } }),
  };
  return transport.send([{}, { type: "event" }, event].map(it => JSON.stringify(it)).join("\\n"));
};
exports.createTransport = (options, send) => {
  const pending = new Set();
  return {
    send(body) {
      const sent = send({ body }).finally(() => pending.delete(sent));
      pending.add(sent);
      return sent;
    },
    flush: async () => (await Promise.all(pending), true),
  };
};
exports.init = options => {
  transport = options.transport(options);
  process.on("uncaughtException", async error => {
    console.error(error);
    await capture(error, { type: "auto.node.onuncaughtexception", handled: false });
    process.exit(1);
  });
  process.on("unhandledRejection", reason => {
    console.warn("This error originated either by throwing inside of an async function without a catch block.");
    capture(reason, { type: "auto.node.onunhandledrejection", handled: false });
  });
};
exports.captureException = error => {
  capture(error, { type: "generic", handled: true });
  return "";
};
exports.flush = timeout => transport.flush(timeout);
`,
};

const program = {
  ...sdk,
  "package.json": JSON.stringify({ name: "app", private: true, dependencies: { "@sentry/bun": "0.0.0" } }),
  "app.ts": `import * as Sentry from "@sentry/bun";
import { chargeCustomer, chargeCustomerLater } from "./billing/charge-customer";

Sentry.init({
  dsn: "https://public@sentry.invalid/1",
  transport: options =>
    Sentry.createTransport(options, async request => {
      console.log(String(request.body));
      return { statusCode: 200 };
    }),
});

function handleCheckout(invoiceAmountInCents: number): number {
  return chargeCustomer(invoiceAmountInCents) + 1;
}

switch (process.argv[2]) {
  case "caught":
    try {
      handleCheckout(-1);
    } catch (error) {
      Sentry.captureException(error);
    }
    await Sentry.flush(2000);
    break;
  case "uncaught":
    handleCheckout(-1);
    break;
  case "rejected":
    void chargeCustomerLater(-1);
    break;
}
`,
  "billing/charge-customer.ts": `class InvoiceLedger {
  recordPayment(paymentInCents: number): number {
    if (paymentInCents < 0) throw new RangeError("negative amount " + paymentInCents);
    return paymentInCents;
  }
}

export function chargeCustomer(amountToCharge: number): number {
  return new InvoiceLedger().recordPayment(amountToCharge) * 2;
}

export async function chargeCustomerLater(amountToCharge: number): Promise<number> {
  await Promise.resolve();
  return chargeCustomer(amountToCharge);
}
`,
};
// Names of functions, classes, parameters and variables. A method is a property, and the program finds properties by name.
const writtenNames = [
  "handleCheckout",
  "chargeCustomer",
  "chargeCustomerLater",
  "InvoiceLedger",
  "invoiceAmountInCents",
  "paymentInCents",
  "amountToCharge",
];

interface SentryFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

interface SentryEvent {
  exception: {
    values: {
      type: string;
      value: string;
      mechanism: { type: string; handled: boolean };
      stacktrace: { frames: SentryFrame[] };
    }[];
  };
  debug_meta?: { images: { type: string; code_file: string; debug_id: string }[] };
}

interface FunctionMap {
  names: string[];
  mappings: string;
}

interface SourceMap {
  version: number;
  file: string;
  debugId: string;
  debug_id: string;
  sources: string[];
  sourcesContent: (string | null)[];
  names: string[];
  mappings: string;
  x_facebook_sources: [FunctionMap][];
}

async function build(folder: string) {
  const flags = ["--minify", "--sourcemap=external", "--outfile", "dist/app"];
  const result = await spawned([bunExe(), "compile", "app.ts", ...flags], folder, env);
  built(result);
  const executable = join(folder, "dist", isWindows ? "app.exe" : "app");
  const buildID = /build id +([0-9a-f]{32})/.exec(result.stdout + result.stderr)![1]!;
  const map: SourceMap = JSON.parse(readFileSync(executable + ".map", "utf8"));
  return { executable, buildID, map };
}

// An envelope is a line of JSON for its header and two for each item.
function eventsIn(stdout: string): SentryEvent[] {
  return stdout
    .split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line))
    .filter(item => item.exception);
}

function decodeSegment(segment: string) {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const fields: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = digits.indexOf(character);
    value |= (digit & 31) << shift;
    shift += 5;
    if (digit & 32) continue;
    fields.push(value & 1 ? -(value >> 1) : value >> 1);
    value = shift = 0;
  }
  return fields;
}

// How Sentry and Metro read a function map: the last entry at or in front of a place in the source names the function around it.
function functionAround({ names, mappings }: FunctionMap, line: number, column: number) {
  let [entryLine, name] = [1, 0];
  let found: string | undefined;
  for (const group of mappings.split(";")) {
    let entryColumn = 0;
    for (const segment of group.split(",")) {
      const [columnDelta, nameDelta = 0, lineDelta = 0] = decodeSegment(segment);
      entryColumn += columnDelta!;
      name += nameDelta;
      entryLine += lineDelta;
      if (entryLine < line || (entryLine === line && entryColumn <= column)) found = names[name];
    }
  }
  return found;
}

async function resolve(map: SourceMap, frames: SentryFrame[]) {
  const consumer = await new SourceMapConsumer(map as never);
  try {
    return frames.map(frame => {
      const found = consumer.originalPositionFor({ line: frame.lineno!, column: frame.colno! - 1 });
      const text = consumer.sourceContentFor(found.source!)!.split("\n")[found.line! - 1]!;
      return {
        file: found.source,
        line: found.line,
        column: found.column! + 1,
        name: found.name,
        function: functionAround(
          map.x_facebook_sources[map.sources.indexOf(found.source!)]![0],
          found.line!,
          found.column!,
        ),
        text: text.trim(),
      };
    });
  } finally {
    consumer.destroy();
  }
}

const inLedger = {
  file: "billing/charge-customer.ts",
  line: 3,
  column: 39,
  name: "recordPayment",
  function: "recordPayment",
  text: 'if (paymentInCents < 0) throw new RangeError("negative amount " + paymentInCents);',
};
const inChargeCustomer = {
  file: "billing/charge-customer.ts",
  line: 9,
  column: 30,
  name: "chargeCustomer",
  function: "chargeCustomer",
  text: "return new InvoiceLedger().recordPayment(amountToCharge) * 2;",
};
const inHandleCheckout = {
  file: "app.ts",
  line: 14,
  column: 10,
  name: "handleCheckout",
  function: "handleCheckout",
  text: "return chargeCustomer(invoiceAmountInCents) + 1;",
};

// Oldest frame first, as in an event.
const cases = [
  {
    argument: "caught",
    mechanism: { type: "generic", handled: true },
    exitCode: 0,
    frames: [
      { file: "app.ts", line: 20, column: 7, name: null, function: "?", text: "handleCheckout(-1);" },
      inHandleCheckout,
      inChargeCustomer,
      inLedger,
    ],
  },
  {
    argument: "uncaught",
    mechanism: { type: "auto.node.onuncaughtexception", handled: false },
    exitCode: 1,
    frames: [
      { file: "app.ts", line: 27, column: 5, name: null, function: "?", text: "handleCheckout(-1);" },
      inHandleCheckout,
      inChargeCustomer,
      inLedger,
    ],
  },
  {
    argument: "rejected",
    mechanism: { type: "auto.node.onunhandledrejection", handled: false },
    exitCode: 0,
    frames: [
      {
        file: "billing/charge-customer.ts",
        line: 14,
        column: 10,
        name: "chargeCustomerLater",
        function: "chargeCustomerLater",
        text: "return chargeCustomer(amountToCharge);",
      },
      inChargeCustomer,
      inLedger,
    ],
  },
];

describe("--sourcemap=external with a Sentry SDK", () => {
  test(
    "events name the map by its debug ID, the map restores files, lines, columns and names, and the executable has no written name",
    () =>
      slot(async () => {
        using dir = tempDir("aot-sentry-source-map", program);
        const folder = String(dir);
        const { executable, buildID, map } = await build(folder);

        const debugID = buildID.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
        expect({ debugId: map.debugId, debug_id: map.debug_id }).toEqual({ debugId: debugID, debug_id: debugID });
        const name = isWindows ? "app.exe" : "app";
        expect(readdirSync(join(folder, "dist")).sort()).toEqual([name, name + ".map", name + ".map.js"]);
        expect(readFileSync(executable + ".map.js", "utf8")).toBe(
          `//# sourceMappingURL=${name}.map\n//# debugId=${debugID}\n`,
        );

        const file = bytesAndStoredStrings(executable);
        expect(writtenNames.filter(name => file.includes(name) || file.includes(Buffer.from(name, "utf16le")))).toEqual(
          [],
        );

        for (const { argument, mechanism, exitCode, frames } of cases) {
          const run = await spawned([executable, argument], folder, env);
          expect({ argument, exitCode: run.exitCode }).toEqual({ argument, exitCode });
          for (const written of [...writtenNames, "charge-customer", "app.ts"]) {
            expect(run.stdout + run.stderr).not.toContain(written);
          }

          const [event, ...others] = eventsIn(run.stdout);
          expect(others).toEqual([]);
          expect(event!.debug_meta).toEqual({
            images: [{ type: "sourcemap", code_file: frameFile, debug_id: debugID }],
          });
          const [exception] = event!.exception.values;
          expect({ type: exception!.type, value: exception!.value, mechanism: exception!.mechanism }).toEqual({
            type: "RangeError",
            value: "negative amount -1",
            mechanism: expect.objectContaining(mechanism),
          });
          const sent = exception!.stacktrace.frames;
          expect(sent.map(frame => ({ filename: frame.filename, in_app: frame.in_app }))).toEqual(
            frames.map(() => ({ filename: frameFile, in_app: true })),
          );
          expect(await resolve(map, sent)).toEqual(frames);
        }
      }),
    buildLimit,
  );

  test(
    "without it, events name the sources by their paths from the folder of the build, and their frames are in app",
    () =>
      slot(async () => {
        using dir = tempDir("aot-sentry", program);
        const folder = String(dir);
        built(await spawned([bunExe(), "compile", "app.ts", "--outfile", "dist/app"], folder, env));
        const executable = join(folder, "dist", isWindows ? "app.exe" : "app");
        for (const { argument, exitCode, frames } of cases) {
          const run = await spawned([executable, argument], folder, env);
          expect({ argument, exitCode: run.exitCode }).toEqual({ argument, exitCode });
          const [event, ...others] = eventsIn(run.stdout);
          expect(others).toEqual([]);
          const sent = event!.exception.values[0]!.stacktrace.frames;
          expect(sent.map(frame => ({ filename: frame.filename, line: frame.lineno, in_app: frame.in_app }))).toEqual(
            frames.map(({ file, line }) => ({ filename: "./" + file, line, in_app: true })),
          );
        }
      }),
    buildLimit,
  );
});
