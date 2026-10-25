// docs/bundler/aot-debugging.mdx, "Use with Sentry": an executable built with --minify --sourcemap=external reports errors through
// the stock @sentry/bun SDK, and the map beside the executable leads from the event back to the sources. Nothing is sent: the
// transport prints the envelopes. The SDK is installed into the temporary folder, so that no other test sees its packages.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SourceMapConsumer } from "source-map";
import { built, slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;
const frameFile = isWindows ? "B:\\~BUN\\root\\compiled.js" : "/$bunfs/root/compiled.js";

const program = {
  "package.json": JSON.stringify({ name: "app", private: true, dependencies: { "@sentry/bun": "11.9.0" } }),
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
  const install = await spawned([bunExe(), "install", "--ignore-scripts"], folder, env);
  expect({ stderr: install.stderr, exitCode: install.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
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

describe("--sourcemap=external with @sentry/bun", () => {
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

        const file = readFileSync(executable);
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
});
