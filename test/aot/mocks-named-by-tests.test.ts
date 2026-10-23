import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const service = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
  }),
  "service.ts": `
    export interface Job { id: number; done: boolean; label: string }
    export function load(id: number): Job { return { id, done: true, label: "real" }; }
    export async function fetchJob(id: number): Promise<Job> { return { id, done: true, label: "real" }; }
    export function other(): string { return "the other, real"; }
    export const settings = { url: "real", retries: 3 };
    export const limits: { low: number; high: number } = { low: 1, high: 2 };
    export class Store { count: number = 1; read(): string { return "a real read"; } write(): string { return "a real write"; } }
  `,
  "user.ts": `
    import { load, fetchJob, other, settings, limits, Store } from "./service";
    export function state(id: number): string { const job = load(id); return [job.id, job.done, job.done ? "done" : "open", job.label, typeof job.label].join(); }
    export async function fetched(id: number): Promise<string> { const job = await fetchJob(id); return [job.id, job.done, job.label].join(); }
    export function rest(): string { return [other(), settings.url, settings.retries, limits.low, limits.high].join(); }
    export function stored(): string { const store = new Store(); return [store.read(), typeof store.write, store.count].join(); }
  `,
};

const header = `
  import { mock, spyOn, test } from "bun:test";
  import * as service from "./service";
  import { state, fetched, rest, stored } from "./user";
  const all = async () => [state(1), await fetched(2), rest(), stored()].join(" | ");
`;

const cases: Record<string, Record<string, string>> = {
  "what a spy returns lacks members that the type requires": {
    ...service,
    "main.test.ts": `${header}
      test("case", async () => {
        console.log("see:", await all());
        spyOn(service, "load").mockReturnValue({ id: 7 } as never);
        spyOn(service, "fetchJob").mockResolvedValue({ label: 5 } as never);
        console.log("see:", await all());
        mock.restore();
        console.log("see:", await all());
      });
    `,
  },
  "a mock supplies records and a class in part": {
    ...service,
    "main.test.ts": `${header}
      test("case", async () => {
        console.log("see:", await all());
        mock.module("./service", () => ({ ...service, settings: { url: "mocked" }, limits: { low: "one" }, Store: class { read() { return "a mocked read"; } } }));
        console.log("see:", await all());
      });
    `,
  },
  "the object that stands for the module comes out of a function, an import() and a require()": {
    ...service,
    "main.test.ts": `${header}
      const byFunction = () => service;
      test("case", async () => {
        spyOn(byFunction(), "other").mockReturnValue("the other, by a function");
        console.log("see:", rest());
        mock.restore();
        const imported = await import("./service");
        spyOn(imported, "other").mockReturnValue("the other, by import()");
        console.log("see:", rest());
        mock.restore();
        const required = require("./service") as typeof import("./service");
        spyOn(required, "other").mockReturnValue("the other, by require()");
        console.log("see:", rest());
        mock.restore();
        const untyped: any = service;
        spyOn(untyped, "other").mockReturnValue("the other, untyped");
        console.log("see:", rest());
        mock.restore();
        console.log("see:", rest());
      });
    `,
  },
  "the name of the module or of the export is computed": {
    ...service,
    "main.test.ts": `${header}
      test("case", async () => {
        for (const name of ["other"] as const) spyOn(service, name).mockReturnValue("the other, by a computed name");
        console.log("see:", rest());
        mock.restore();
        const specifier = ["./service"][0];
        mock.module(specifier, () => ({ ...service, other: () => "the other, of a module by a computed name" }));
        console.log("see:", rest());
      });
    `,
  },
  "a helper in another file lays the mock": {
    ...service,
    "helper.ts": `
      import { mock } from "bun:test";
      import * as service from "./service";
      export function lay(): void { mock.module("./service", () => ({ ...service, other: () => "the other, by a helper" })); }
    `,
    "main.test.ts": `${header}
      import { lay } from "./helper";
      test("case", () => { console.log("see:", rest()); lay(); console.log("see:", rest()); });
    `,
  },
};

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

// The compiler itself has no support for mocks: the debugging option that runs the tests as compiled code refuses them.
test("bun test --debug-aot refuses a spy on an export of a compiled module", async () => {
  using dir = tempDir("mocks-named-by-tests", cases["what a spy returns lacks members that the type requires"]);
  const { stderr, exitCode } = await run([bunExe(), "test", "--debug-aot", "./main.test.ts"], String(dir));
  expect(stderr).toContain(
    "TypeError: Cannot spy on 'load' because module exports can't be replaced in a compiled executable",
  );
  expect(exitCode).toBe(1);
}, 120_000);

test.concurrent.each(Object.keys(cases))(
  "bun test --aot prints what bun test prints: %s",
  async name => {
    using dir = tempDir("mocks-named-by-tests", cases[name]);
    const plain = await seen(String(dir), ["test", "./main.test.ts"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBeGreaterThan(0);
    expect(await seen(String(dir), ["test", "--aot", "./main.test.ts"])).toEqual(plain);
  },
  120_000,
);
