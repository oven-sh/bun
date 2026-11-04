import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// barrel.js hands on a package and a file of the project by `export *`, and both have x.
// While a mock stands in place of the package the first star that has a name gives it; without the mock x is ambiguous and nobody has it.
const project = (stars: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "type": "module" }`,
  "node_modules/pkg/index.js": `export * from "./inner.js";\nexport const y = "real y";`,
  "node_modules/pkg/inner.js": `export const x = "real x";\nexport const f = "real f";`,
  "clash.js": `export const x = "clash x";\nexport const other = "other";`,
  "barrel.js": stars,
  "over.js": `export * from "./barrel.js";`,
  "user.js": `import * as barrel from "./barrel.js";
import * as over from "./over.js";
const show = ns => ["x", "y", "f", "other"].map(name => name + "=" + ns[name]).join(" ") + " keys=" + Object.keys(ns).join("+");
export const seen = () => show(barrel) + " | " + show(over);`,
  "a.test.js": `import { test, vi } from "bun:test";
vi.mock("pkg", () => ({ x: "mock x", f: "mock f" }));
import { seen } from "./user.js";
test("t", async () => {
  console.log("SEEN under the mock", seen());
  const barrel = await import("./barrel.js");
  console.log("SEEN import()", barrel.x, barrel.y, barrel.f, barrel.other);
});`,
  "b.test.js": `import { test } from "bun:test";
import { seen } from "./user.js";
test("t", () => console.log("SEEN the next file", seen()));`,
});

const inProject = (files: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name !== "node_modules/pkg/package.json")
      .map(([name, text]) => [name.replace("node_modules/pkg/", "lib/"), text.replaceAll(`"pkg"`, `"./lib/index.js"`)]),
  );

// mock.module() is not hoisted: the imports of the test file have run when it is called. Such a mock replaces values, and x stays ambiguous.
const laidOver = (files: Record<string, string>) => ({
  ...files,
  "a.test.js": files["a.test.js"].replace("{ test, vi }", "{ mock, test }").replace("vi.mock(", "mock.module("),
});

const first = project(`export * from "pkg";\nexport * from "./clash.js";`);
const last = project(`export * from "./clash.js";\nexport * from "pkg";`);
const projects = {
  "the package's star stands first": first,
  "the package's star stands last": last,
  "a file of the project in place of the package, its star first": inProject(first),
  "a file of the project in place of the package, its star last": inProject(last),
  "the mock is laid over the package, its star first": laidOver(first),
  "the mock is laid over a file of the project, its star last": laidOver(inProject(last)),
};

// Each project is a folder of one project, with its own packages below it, and says its folder in what it prints: two runs for all of them.
// But one: on a build in front of the cures it differed from plain Bun by itself and no longer beside the others.
const standsAlone = "a file of the project in place of the package, its star last";
const folders = Object.keys(projects).map((name, index) => [name, `p${index}`]);
const dirs: ReturnType<typeof tempDir>[] = [];
afterAll(() => dirs.forEach(dir => dir[Symbol.dispose]()));
const filesOf = (alone: boolean) =>
  Object.fromEntries(
    folders
      .filter(([name]) => (name === standsAlone) === alone)
      .flatMap(([name, folder]) =>
        Object.entries(projects[name]).map(([path, text]) => [
          `${folder}/${path}`,
          text.replaceAll(`"SEEN `, `"SEEN ${folder} `),
        ]),
      ),
  );
const made = new Map<boolean, string>();
const runs = new Map<string, Promise<{ lines: string[]; exitCode: number | null }>>();
const ran = (alone: boolean, flags: string[]) =>
  runs.getOrInsertComputed(`${alone} ${flags}`, async () => {
    const cwd = made.getOrInsertComputed(alone, () => {
      dirs.push(
        tempDir("aot-mock-package-star", { "package.json": `{ "name": "all", "type": "module" }`, ...filesOf(alone) }),
      );
      return String(dirs.at(-1));
    });
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags], cwd, bunEnv);
    return { lines: stdout.split("\n"), exitCode };
  });

for (const [name, folder] of folders) {
  test.concurrent(
    `${name}: compiled as under plain Bun`,
    async () => {
      const seen = async (flags: string[]) => {
        const { lines, exitCode } = await ran(name === standsAlone, flags);
        return { lines: lines.filter(line => line.startsWith(`SEEN ${folder} `)), exitCode };
      };
      const plain = await seen([]);
      expect(plain.lines.length).toBe(3);
      expect(await seen(["--aot"])).toEqual(plain);
    },
    240_000,
  );
}
