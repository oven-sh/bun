import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Below a hoisted mock the imports of a test file become loads, and every written use of an imported name is rewritten. The factory and the fragment of classic JSX,
// and a class that decorator metadata names, are written nowhere: such an import stays a statement.
const h = `export function h(tag, props, ...children) { return { tag, props, children }; }`;
const other = `export const x = 1;`;
const classic = (options: object = {}) =>
  JSON.stringify({ compilerOptions: { jsx: "react", strict: false, ...options } });
const projects: Record<string, Record<string, string>> = {
  "a factory by name": {
    "tsconfig.json": classic({ jsxFactory: "h" }),
    "h.js": h,
    "other.js": other,
    "a.test.jsx": `import { test, vi } from "bun:test";
import { h } from "./h.js";
import { x } from "./other.js";
vi.mock("./other.js", () => ({ x: 2 }));
test("t", () => console.log("SEEN", JSON.stringify(<p>{x}</p>), h.length));`,
  },
  "a fragment": {
    "tsconfig.json": classic({ jsxFactory: "h", jsxFragmentFactory: "Frag" }),
    "h.js": h,
    "f.js": `export const Frag = "frag";`,
    "other.js": other,
    "a.test.jsx": `import { test, vi } from "bun:test";
import { h } from "./h.js";
import { Frag } from "./f.js";
import { x } from "./other.js";
vi.mock("./other.js", () => ({ x: 2 }));
test("t", () => console.log("SEEN", JSON.stringify(<>{x}</>)));`,
  },
  "a class that decorator metadata names": {
    "tsconfig.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, strict: false } }), // prettier-ignore
    "dep.ts": `export class Dep {}`,
    "other.ts": other,
    "a.test.ts": `import { test, vi } from "bun:test";
import { Dep } from "./dep";
import { x } from "./other";
vi.mock("./other", () => ({ x: 2 }));
function Inject(target: any) { return target; }
(Reflect as any).metadata ??= (k: string, v: any) => (t: any) => { (t.meta ??= {})[k] = v; };
@Inject
class Svc { constructor(public d: Dep) {} }
test("t", () => console.log("SEEN", (Svc as any).meta["design:paramtypes"].map((c: any) => c.name).join(), new Dep() instanceof Dep, x));`,
  },
};

test.each(Object.keys(projects))(
  "%s: as plain Bun",
  async name => {
    using dir = tempDir("aot-mock-beside-jsx", {
      "package.json": `{ "name": "p", "type": "module" }`,
      ...projects[name],
    });
    const seen = async (...flags: string[]) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      const lines = (stdout + "\n" + stderr).split("\n");
      return lines.filter(line => line.startsWith("SEEN") || /^warn: TS\d+/.test(line));
    };
    const plain = await seen();
    expect(plain.length).toBeGreaterThan(0);
    expect(await seen("--aot")).toEqual(plain);
  },
  600000,
);
