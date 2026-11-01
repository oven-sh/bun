import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// An import below a hoisted mock loads behind the mock, also where nothing spells its names: the factory and the fragment of classic JSX, a class that decorator
// metadata names, a namespace in an export clause. Every module says when it runs.
const projects: Record<string, Record<string, string>> = {
  "the mocked file is the JSX factory": {
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react" } }`,
    "react.js": `console.log("runs react"); export default { createElement(tag, props, ...children) { return { real: tag }; } };`,
    "a.test.jsx": `import { test, vi } from "bun:test";
import React from "./react.js";
vi.mock("./react.js", () => { console.log("factory"); return { default: { createElement(tag) { return { mocked: tag }; } } }; });
test("t", () => console.log("OUT", JSON.stringify(<p>1</p>), JSON.stringify(React.createElement("q"))));`,
  },
  "the JSX factory's file imports the mocked file": {
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react" } }`,
    "knob.js": `console.log("runs knob"); export const knob = "real";`,
    "react.js": `console.log("runs react"); import { knob } from "./knob.js"; const atLoad = knob; export default { createElement(tag) { return { tag, knob, atLoad }; } };`,
    "a.test.jsx": `import { test, vi } from "bun:test";
import React from "./react.js";
vi.mock("./knob.js", () => { console.log("factory"); return { knob: "mocked" }; });
test("t", () => console.log("OUT", JSON.stringify(<p>1</p>)));`,
  },
  "the mocked file holds the class of the metadata": {
    "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": false } }`,
    "dep.ts": `console.log("runs dep"); export class Dep { who() { return "real"; } }`,
    "a.test.ts": `import { test, vi } from "bun:test";
import { Dep } from "./dep";
vi.mock("./dep", () => { console.log("factory"); return { Dep: class MockedDep { who() { return "mocked"; } } }; });
function Inject(target: any) { return target; }
(Reflect as any).metadata ??= (k: string, v: any) => (t: any) => { (t.meta ??= {})[k] = v; };
@Inject
class Svc { constructor(public d: Dep) {} }
test("t", () => console.log("OUT", (Svc as any).meta["design:paramtypes"].map((c: any) => c.name).join(), new Dep().who()));`,
  },
  "the files load in the order of the imports": {
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react", "jsxFactory": "h" } }`,
    "first.js": `console.log("runs first"); export const first = 1;`,
    "h.js": `console.log("runs h"); export function h(tag) { return { tag }; }`,
    "last.js": `console.log("runs last"); export const last = 3;`,
    "other.js": `console.log("runs other"); export const x = 1;`,
    "a.test.jsx": `import { test, vi } from "bun:test";
import { first } from "./first.js";
import { h } from "./h.js";
import { last } from "./last.js";
import { x } from "./other.js";
vi.mock("./other.js", () => { console.log("factory"); return { x: 2 }; });
test("t", () => console.log("OUT", JSON.stringify(<p/>), first, last, x));`,
  },
  "an import with spelled and unspelled uses": {
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react" } }`,
    "knob.js": `console.log("runs knob"); export const knob = "real";`,
    "react.js": `console.log("runs react"); import { knob } from "./knob.js"; const atLoad = knob; export function useKnob() { return atLoad; } export default { createElement(tag, props, ...kids) { return { tag, atLoad, kids }; }, Fragment: "frag" };`,
    "a.test.jsx": `import { test, vi } from "bun:test";
import React, { useKnob } from "./react.js";
vi.mock("./knob.js", () => { console.log("factory"); return { knob: "mocked" }; });
test("t", () => console.log("OUT", JSON.stringify(<p><></></p>), useKnob(), typeof React.createElement, React.Fragment));`,
  },
  "the factory by a namespace": {
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react" } }`,
    "knob.js": `console.log("runs knob"); export const knob = "real";`,
    "react.js": `console.log("runs react"); import { knob } from "./knob.js"; const atLoad = knob; export function createElement(tag) { return { tag, atLoad }; } export const Fragment = "frag";`,
    "a.test.jsx": `import { test, vi } from "bun:test";
import * as React from "./react.js";
vi.mock("./knob.js", () => { console.log("factory"); return { knob: "mocked" }; });
test("t", () => console.log("OUT", JSON.stringify(<p/>), JSON.stringify(<></>)));`,
  },
  "a local of the factory's name": {
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react" } }`,
    "knob.js": `console.log("runs knob"); export const knob = "real";`,
    "react.js": `console.log("runs react"); import { knob } from "./knob.js"; const atLoad = knob; export default { createElement(tag) { return { tag, atLoad }; } };`,
    "a.test.jsx": `import { test, vi } from "bun:test";
import React from "./react.js";
vi.mock("./knob.js", () => { console.log("factory"); return { knob: "mocked" }; });
function inner() { const React = { createElement(tag) { return { local: tag }; } }; return <i/>; }
function byParameter(React) { return <b/>; }
test("t", () => console.log("OUT", JSON.stringify(<p/>), JSON.stringify(inner()), JSON.stringify(byParameter({ createElement: tag => "param " + tag }))));`,
  },
  "the namespace is used in types too": {
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react", "strict": true } }`,
    "knob.ts": `console.log("runs knob"); export const knob: string = "real";`,
    "react.ts": `console.log("runs react"); import { knob } from "./knob"; const atLoad = knob;
export type FC<P> = (props: P) => { tag: unknown; atLoad: string };
export function createElement(tag: unknown, props?: unknown): { tag: unknown; atLoad: string } { return { tag: typeof tag === "function" ? "fn" : tag, atLoad }; }
declare global { namespace JSX { interface IntrinsicElements { p: {}; } interface Element { tag: unknown; atLoad: string } } }`,
    "a.test.tsx": `import { test, vi } from "bun:test";
import * as React from "./react";
vi.mock("./knob", () => { console.log("factory"); return { knob: "mocked" }; });
const Part: React.FC<{ n: number }> = props => <p/>;
test("t", () => console.log("OUT", JSON.stringify(<Part n={1}/>), JSON.stringify(Part({ n: 2 }))));`,
  },
  "the factory by a comment": {
    "knob.js": `console.log("runs knob"); export const knob = "real";`,
    "h.js": `console.log("runs h"); import { knob } from "./knob.js"; const atLoad = knob; export const lib = { h(tag) { return { tag, atLoad }; }, F: "frag" };`,
    "a.test.jsx": `/** @jsxRuntime classic */
/** @jsx lib.h */
/** @jsxFrag lib.F */
import { test, vi } from "bun:test";
import { lib } from "./h.js";
vi.mock("./knob.js", () => { console.log("factory"); return { knob: "mocked" }; });
test("t", () => console.log("OUT", JSON.stringify(<p/>), JSON.stringify(<></>)));`,
  },
  "a constructor's parameter types, and a mock below the class's file": {
    "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": false } }`,
    "db.ts": `console.log("runs db"); export const url = "real";`,
    "repo.ts": `console.log("runs repo"); import { url } from "./db"; const atLoad = url; export class Repo { where() { return atLoad; } }`,
    "a.test.ts": `import { test, jest } from "bun:test";
import { Repo } from "./repo";
jest.mock("./db", () => { console.log("factory"); return { url: "mocked" }; });
function Injectable() { return (target: any) => target; }
(Reflect as any).metadata ??= (k: string, v: any) => (t: any, p?: any) => { ((p ? t.constructor : t).meta ??= {})[(p ?? "") + k] = v; };
@Injectable()
class Svc { constructor(private r: Repo) {} where() { return this.r.where(); } }
test("t", () => { const [C] = (Svc as any).meta["design:paramtypes"]; console.log("OUT", C.name, new Svc(new C()).where()); });`,
  },
  "fields, methods and accessors; other names, a default, a namespace": {
    "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": false } }`,
    "db.ts": `console.log("runs db"); export const url = "real";`,
    "repo.ts": `console.log("runs repo"); import { url } from "./db"; const atLoad = url; export class Repo { static at = atLoad; } export class Other { static at = "other " + atLoad; } export default class Main { static at = "main " + atLoad; }`,
    "a.test.ts": `import { test, vi } from "bun:test";
import Main, { Repo as R, Other } from "./repo";
import * as all from "./repo";
vi.mock("./db", () => { console.log("factory"); return { url: "mocked" }; });
const seen: string[] = [];
(Reflect as any).metadata ??= (k: string, v: any) => (t: any, p?: any) => { seen.push(String(p) + " " + k + " " + [v].flat().map((c: any) => c?.at ?? c?.name).join()); };
function Dec(...a: any[]): any {}
class Svc {
  @Dec field: R;
  @Dec method(a: Other, b: Main): all.Repo { return null as any; }
  @Dec get accessor(): Main { return null as any; }
  @Dec optional?: R | undefined;
  @Dec list: R[];
}
test("t", () => console.log("OUT", seen.join(" | ")));`,
  },
  "a local class and a type parameter of the class's name": {
    "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": false } }`,
    "db.ts": `console.log("runs db"); export const url = "real";`,
    "repo.ts": `console.log("runs repo"); import { url } from "./db"; export class Repo { static at = url; } export interface Shape { a: number }`,
    "a.test.ts": `import { test, vi } from "bun:test";
import { Repo, Shape } from "./repo";
vi.mock("./db", () => { console.log("factory"); return { url: "mocked" }; });
const seen: string[] = [];
(Reflect as any).metadata ??= (k: string, v: any) => (t: any, p?: any) => { seen.push(String(p) + " " + k + " " + [v].flat().map((c: any) => c?.at ?? c?.name).join()); };
function Dec(...a: any[]): any {}
function make() { class Repo { static at = "local"; } class Inner { @Dec f: Repo; } return Inner; }
class Generic<Repo> { @Dec f: Repo; @Dec s: Shape; }
class Outer { @Dec f: Repo; }
make();
test("t", () => console.log("OUT", seen.join(" | ")));`,
  },
  "a namespace that the test file exports": {
    "a.test.ts": `import { test, expect, vi } from "bun:test";
import * as ns from "./uses-dep";
vi.mock("./dep", () => ({ name: "mocked" }));
export { ns };
test("t", () => { console.log("SAY", ns.seen, (globalThis as any).seenAtLoad); expect(1).toBe(1); });`,
    "dep.ts": `export const name = "real";`,
    "uses-dep.ts": `import { name } from "./dep"; (globalThis as any).seenAtLoad = name; export const seen = name;`,
  },
  "an alias of a member of the namespace": {
    "dep.ts": `console.log("runs dep"); export const name = "real";`,
    "uses-dep.ts": `console.log("runs uses-dep"); import { name } from "./dep"; export const seen = name; export namespace inner { export const deep = "deep " + name; }`,
    "a.test.ts": `import { test, vi } from "bun:test";
import * as ns from "./uses-dep";
import { inner } from "./uses-dep";
vi.mock("./dep", () => { console.log("factory"); return { name: "mocked" }; });
import seen = ns.seen;
import deep = inner.deep;
import far = ns.inner.deep;
test("t", () => console.log("OUT", seen, deep, far));`,
  },
  "an attribute that chooses no loader": {
    "a.test.ts": `import { test, expect, vi } from "bun:test";
import { seen } from "./uses-dep" with { mine: "yes" };
vi.mock("./dep", () => ({ name: "mocked" }));
test("t", () => { console.log("SAY", seen); expect(1).toBe(1); });`,
    "dep.ts": `export const name = "real";`,
    "uses-dep.ts": `import { name } from "./dep"; export const seen = name;`,
  },
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:8" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

for (const [name, files] of Object.entries(projects)) {
  for (const [way, env] of ways) {
    test.concurrent(`${name}, ${way}`, async () => {
      using dir = tempDir("mock-unspelled-names", { "package.json": `{}`, ...files });
      const plain = await runTests(String(dir), {});
      expect(plain.exitCode).toBe(0);
      expect(plain.printed.length).toBeGreaterThan(0);
      expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
    });
  }
}
