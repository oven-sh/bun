// Without `@types/bun`, TypeScript knows neither `console` nor the module "bun", and `bun check` says so. A build goes on: what Bun
// provides is of type `any`, and the executable does what `bun run` does. Every other type error stops the build as always.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildTimeout = 300_000;

async function build(folder: string) {
  const command = [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "app"];
  const { stderr, exitCode, signal } = await spawned(command, folder, env);
  const lines = stderr.split("\n");
  const codes = (label: string) =>
    lines.flatMap(line => new RegExp(`^${label}: (TS\\d+): `).exec(line)?.[1] ?? []).sort();
  return { errors: codes("error"), warnings: codes("warn"), exitCode, signal };
}

async function check(folder: string, ...flags: string[]) {
  const { stdout, exitCode, signal } = await spawned(
    [bunExe(), "check", ...flags, "--no-pretty", "main.ts"],
    folder,
    env,
  );
  const codes = (label: string) =>
    stdout
      .split("\n")
      .flatMap(line => new RegExp(`^main\\.ts\\(\\d+,\\d+\\): ${label} (TS\\d+): `).exec(line)?.[1] ?? [])
      .sort();
  return { errors: codes("error"), warnings: codes("warning"), exitCode, signal };
}

async function run(folder: string, how: "compiled" | "plain") {
  const command = how === "compiled" ? [join(folder, isWindows ? "app.exe" : "app")] : [bunExe(), "run", "main.ts"];
  const { stdout, exitCode, signal } = await spawned(command, folder, bunEnv);
  return { stdout, exitCode, signal };
}

const built = { errors: [], warnings: [], exitCode: 0, signal: null };

// What a program may use without a declaration, and the errors of `bun check` that a build does not repeat.
const provided: Record<
  string,
  { files: Record<string, string>; checkSays: string[]; warnings?: string[]; prints: string }
> = {
  "console": { files: { "main.ts": `console.log("ran");\n` }, checkSays: ["TS2584"], prints: "ran\n" },
  "the module bun": {
    files: { "main.ts": `import { version } from "bun";\nconsole.log(typeof version);\n` },
    checkSays: ["TS2307", "TS2584"],
    prints: "string\n",
  },
  "globals of Bun, of Node.js and of the web, as values and as types": {
    files: {
      "main.ts": `const response: Response = new Response("body");
const url: URL = new URL("https://example.com/path");
const timer: Timer = setTimeout(() => {}, 1000);
clearTimeout(timer);
const interval: NodeJS.Timeout = setInterval(() => {}, 1000);
clearInterval(interval);
console.log(typeof Bun.version, typeof process.argv, Buffer.from("a").length, await response.text(), url.pathname, typeof fetch, new TextEncoder().encode("ab").length, typeof structuredClone, typeof performance.now());
`,
    },
    checkSays: [],
    prints: "string object 1 body /path function 2 function number\n",
  },
  "what every module is given": {
    files: {
      "main.ts": `const path = require("node:path");\nconsole.log(path.basename(__filename), typeof __dirname, typeof module, typeof exports, typeof import.meta.dir, import.meta.main);\n`,
    },
    checkSays: [],
    prints: "main.ts string object object string true\n",
  },
  "modules of Bun and of Node.js": {
    files: {
      "main.ts": `import { basename } from "node:path";
import os from "os";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
const server: Server | undefined = undefined;
console.log(basename("/a/b.txt"), typeof os.cpus, typeof Database, server);
`,
    },
    checkSays: [],
    prints: "b.txt function function undefined\n",
  },
  "files that only Bun's declarations give a type": {
    files: {
      "main.ts": `import text from "./note.txt";\nimport settings from "./settings.toml";\nimport untyped from "./untyped.js";\nconsole.log(text.trim(), settings.n, untyped);\n`,
      "note.txt": "note\n",
      "settings.toml": "n = 1\n",
      "untyped.js": `export default "untyped";\n`,
    },
    checkSays: [],
    prints: "note 1 untyped\n",
  },
  "a file whose name has a quote in it": {
    files: {
      "main.ts": `import text from "./it's a note.txt";\nconsole.log(text.trim());\n`,
      "it's a note.txt": "note\n",
    },
    checkSays: [],
    prints: "note\n",
  },
  "members of Bun and of import.meta, by destructuring and in types": {
    files: {
      "main.ts": `const { version } = Bun;
const { dir } = import.meta;
type Directory = ImportMeta["dir"];
const directory: Directory = dir;
const server: Bun.Server | undefined = undefined;
const other: import("bun").Server | undefined = undefined;
console.log(typeof version, typeof directory, server, other);
`,
    },
    checkSays: [],
    prints: "string string undefined undefined\n",
  },
  "callbacks for what has no declaration": {
    files: {
      "main.ts": `process.on("exit", code => console.log("exit", code));
const server = Bun.serve({ port: 0, fetch(request) { return new Response(new URL(request.url).pathname); } });
console.log(await (await fetch(new URL("/path", server.url))).text());
server.stop(true);
`,
    },
    checkSays: [],
    prints: "/path\nexit 0\n",
  },
  "what TypeScript's own libraries declare, with its types": {
    files: {
      "main.ts": `function shout(word: string | undefined): string { if (word === undefined) return "none"; return word.toUpperCase(); }
const sizes = new Map<string, number>([["a", 1]]);
const found = sizes.get("a");
if (found !== undefined) console.log(shout("a"), shout(undefined), found.toFixed(1), typeof globalThis, Number.isNaN(NaN), await Promise.resolve([1, 2].length));
`,
    },
    checkSays: ["TS2584"],
    prints: "A none 1.0 object true 2\n",
  },
  "classes below classes of Bun and of Node.js": {
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
class Bus extends EventEmitter { count = 0; bump() { this.count++; this.emit("bump", this.count); } }
class Packet extends Buffer { tag(): string { return "a packet"; } }
const bus = new Bus();
bus.on("bump", n => console.log("bump", n));
bus.bump();
console.log(Packet.from("ab").length, Object.getPrototypeOf(Packet) === Buffer);
`,
    },
    checkSays: [],
    prints: "bump 1\n2 true\n",
  },
  "classes of Bun's and Node.js's modules as types": {
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
import { Database } from "bun:sqlite";
import type { Server } from "node:http";
const bus: EventEmitter = new EventEmitter();
function rows(database: Database): number { return database.query("select 1 as one").all().length; }
const servers: Server[] = [];
console.log(bus.listenerCount("none"), rows(new Database(":memory:")), servers.length);
`,
    },
    checkSays: [],
    prints: "0 1 0\n",
  },
  "type arguments for what has no declaration": {
    files: {
      "main.ts": `import { serve } from "bun";
const server = serve<{ id: string }>({ port: 0, fetch() { return Response.json({ ok: true }); } });
const answer = await fetch(server.url).then(response => response.json());
console.log(answer.ok);
server.stop(true);
`,
    },
    checkSays: [],
    prints: "true\n",
  },
  "a tsconfig.json that names the types of Bun, as bun init writes it": {
    files: {
      "main.ts": `console.log(typeof Bun.version);\n`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          lib: ["ESNext"],
          module: "Preserve",
          moduleResolution: "bundler",
          strict: true,
          types: ["bun"],
        },
      }),
    },
    checkSays: [],
    warnings: ["TS2688"],
    prints: "string\n",
  },
};

const stillErrors: [string, string, string[]][] = [
  ["a name that nothing provides", `console.log(notDeclaredAnywhere);\n`, ["TS2304"]],
  ["a name that only a browser provides", `console.log(document.title);\n`, ["TS2584"]],
  ["a name that is nearly one of Bun's", `consle.log("typo");\n`, ["TS2552"]],
  ["a type error", `const port: number = "3000";\nconsole.log(port);\n`, ["TS2322"]],
  [
    "a wrong use of what TypeScript's own libraries declare",
    `const size: string = new Map<string, number>().size;\nconsole.log(size, [1].lenght);\n`,
    ["TS2322", "TS2551"],
  ],
  [
    "a value that may be undefined",
    `const found = new Map<string, number>().get("a");\nconsole.log(found.toFixed(1));\n`,
    ["TS18048"],
  ],
  [
    "a type error in what a program declares itself",
    `function twice(n: number): number { return n * 2; }\nconsole.log(twice("2"));\n`,
    ["TS2345"],
  ],
  [
    "a missing member of the program's own type named ImportMeta",
    `interface ImportMeta { own: number }\nconst meta: ImportMeta = { own: 1 };\nconsole.log(meta.dir);\nexport {};\n`,
    ["TS2339"],
  ],
  ['a missing member of the string "bun"', `const name = "bun" as const;\nconsole.log(name.serve);\n`, ["TS2339"]],
  [
    "a global that is no class, used as a type",
    `const memory: WebAssembly | undefined = undefined;\nconsole.log(memory);\n`,
    ["TS2749"],
  ],
  [
    "a missing member whose name quotes ImportMeta",
    `type Own = { a: number };\ntype Missing = Own["'ImportMeta'"];\nconst value: Missing | undefined = undefined;\nconsole.log(value);\n`,
    ["TS2339"],
  ],
];

describe.concurrent("without Bun's type declarations", () => {
  for (const [what, { files, checkSays, warnings = [], prints }] of Object.entries(provided)) {
    test(
      `a build goes on where a program uses ${what}`,
      () =>
        slot(async () => {
          using dir = tempDir("aot-missing-bun-types", files);
          const folder = String(dir);
          const checked = await check(folder);
          expect(checked.exitCode).toBe(1);
          if (checkSays.length) expect(checked.errors).toEqual(checkSays);
          expect((await check(folder, "--aot")).exitCode).toBe(0);
          expect(await build(folder)).toEqual({ ...built, warnings });
          const expected = { stdout: prints, exitCode: 0, signal: null };
          expect(await run(folder, "plain")).toEqual(expected);
          expect(await run(folder, "compiled")).toEqual(expected);
        }),
      buildTimeout,
    );
  }

  test.each(stillErrors)(
    "bun check --aot and a build stop at %s",
    (_what, source, errors) =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", { "main.ts": source });
        const stopped = { errors, warnings: [], exitCode: 1, signal: null };
        expect(await check(String(dir), "--aot")).toEqual(stopped);
        expect(await build(String(dir))).toEqual(stopped);
      }),
    buildTimeout,
  );

  test(
    "a module that Bun provides has the types of an installed package that declares it",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import { WebSocketServer } from "ws";\nconst server = new WebSocketServer({ port: 0 });\nserver.on("connection", socket => socket.send("a", "b"));\nserver.close();\n`,
          "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
          "node_modules/@types/ws/package.json": JSON.stringify({
            name: "@types/ws",
            version: "8.0.0",
            types: "index.d.ts",
          }),
          "node_modules/@types/ws/index.d.ts": `export declare class WebSocket { send(data: string): void; }\nexport declare class WebSocketServer {\n  constructor(options: { port: number });\n  on(event: "connection", listener: (socket: WebSocket) => void): this;\n  close(): void;\n}\n`,
        });
        expect(await build(String(dir))).toEqual({ errors: ["TS2554"], warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  test(
    "a parameter without a type stops the build of a project whose tsconfig.json is strict",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `function twice(n) { return n * 2; }\nconsole.log(twice(2));\n`,
          "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
        });
        expect(await build(String(dir))).toEqual({ errors: ["TS7006"], warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );
});

test(
  "a build with Bun's type declarations has nothing to report",
  () =>
    slot(async () => {
      using dir = tempDirWithBunTypes("aot-bun-types", {
        "main.ts": `import { version } from "bun";\nconsole.log(typeof version);\n`,
      });
      expect(await build(String(dir))).toEqual(built);
      expect(await run(String(dir), "compiled")).toEqual({ stdout: "string\n", exitCode: 0, signal: null });
    }),
  buildTimeout,
);
