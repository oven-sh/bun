import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// Under --aot the prototypes of six classes that Bun provides are locked like the prototypes of the language.
// programs/host-classes has what a compiled program prints. Here: the refusal, in an executable and under bun run --aot.

const classes = ["Request", "Response", "Blob", "Headers", "URL", "URLSearchParams"];

async function bun(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd, { ...bunEnv, NO_COLOR: "1" });
  return { stdout, stderr, exitCode };
}

const attempts = `
const attempts = {
  add: (C) => { C.prototype.added = 1; },
  replace: (C) => { C.prototype.toString = function () {}; },
  define: (C) => { Object.defineProperty(C.prototype, "added", { value: 1 }); },
  reparent: (C) => { Object.setPrototypeOf(C.prototype, {}); },
};
for (const C of [${classes.join(", ")}]) {
  for (const [kind, attempt] of Object.entries(attempts)) {
    try { attempt(C); console.log(C.name, kind, "was allowed"); } catch (e) { console.log(C.name, kind, e.name + ": " + e.message); }
  }
}
`;
const refusals = classes.flatMap(name =>
  ["add", "replace", "define", "reparent"].map(kind => `${name} ${kind} TypeError`),
);
const withoutMessage = (text: string) =>
  text
    .trim()
    .split("\n")
    .map(line => line.replace(/:.*$/, ""));

test("every write is refused with a TypeError", async () => {
  using dir = tempDir("locked-host-prototypes", { "main.mjs": attempts });
  const cwd = String(dir);
  const build = await bun(cwd, "build", "--compile", "--aot", "main.mjs", "--outfile", "program");
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  await using program = Bun.spawn({ cmd: [join(cwd, "program")], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect(withoutMessage(await program.stdout.text())).toEqual(refusals);
  expect(await program.exited).toBe(0);
  const run = await bun(cwd, "run", "--aot", "main.mjs");
  expect(withoutMessage(run.stdout)).toEqual(refusals);
}, 120_000);

// The message is the engine's own, such as "Attempted to assign to readonly property."
test.todo("the refusal names the prototype and the property and says what to do instead");

const declarations = {
  typeRoots: [join(import.meta.dir, "..", "..", "packages")],
  types: ["bun-types"],
  skipLibCheck: true,
};
const compilerOptions = {
  target: "esnext",
  module: "preserve",
  moduleResolution: "bundler",
  noEmit: true,
  ...declarations,
};

test.each([
  ["without type declarations", {}],
  ["with Bun's type declarations", { "tsconfig.json": JSON.stringify({ compilerOptions }) }],
])(
  "bun test --aot can spy on their methods, as bun test can, %s",
  async (_, configuration) => {
    using dir = tempDir("locked-host-prototypes-spies", {
      ...configuration,
      "reads.ts": `
      export const header = (headers: Headers, name: string) => headers.get(name);
      export const param = (params: URLSearchParams, name: string) => params.get(name);
      export const query = (text: string, name: string) => new URL(text).searchParams.get(name);
      export const shown = (url: URL) => url.toString();
      export const body = (response: Response) => response.json();
      export const part = (blob: Blob) => blob.slice(0, 1).size;
      export const copy = (request: Request) => request.clone().url;
    `,
      "main.test.ts": `
      import { expect, spyOn, test } from "bun:test";
      import * as reads from "./reads";
      test("spies", async () => {
        const all = () => Promise.all([
          reads.header(new Headers({ a: "1" }), "a"),
          reads.param(new URLSearchParams("a=1"), "a"),
          reads.query("http://example.com/?a=1", "a"),
          reads.shown(new URL("http://example.com/")),
          reads.body(new Response("[1]")),
          reads.part(new Blob(["abc"])),
          reads.copy(new Request("http://example.com/")),
        ]);
        console.log("see:", JSON.stringify(await all()));
        const spies = [
          spyOn(Headers.prototype, "get").mockReturnValue("spied"),
          spyOn(URLSearchParams.prototype, "get").mockReturnValue("spied"),
          spyOn(URL.prototype, "toString").mockReturnValue("spied"),
          spyOn(Response.prototype, "json").mockResolvedValue("spied"),
          spyOn(Blob.prototype, "slice").mockReturnValue(new Blob(["spied"])),
          spyOn(Request.prototype, "clone").mockReturnValue(new Request("http://spied.example/")),
        ];
        console.log("see:", JSON.stringify(await all()), spies.map(spy => spy.mock.calls.length).join());
        for (const spy of spies) spy.mockRestore();
        console.log("see:", JSON.stringify(await all()), spies.map(spy => spy.mock.calls.length).join());
      });
    `,
    });
    const seen = async (...args: string[]) => {
      const ran = await bun(String(dir), ...args);
      const printed = ran.stdout + ran.stderr;
      return {
        seen: printed.split("\n").filter(line => line.startsWith("see:")),
        exitCode: ran.exitCode,
        printedByFailure: ran.exitCode ? printed : "",
      };
    };
    const plain = await seen("test", "./main.test.ts");
    expect(plain).toEqual({ seen: expect.any(Array), exitCode: 0, printedByFailure: "" });
    expect(plain.seen.length).toBe(3);
    expect(await seen("test", "--aot", "./main.test.ts")).toEqual(plain);
  },
  120_000,
);
