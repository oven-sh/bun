import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const runtime = `
  function show(tag: unknown): string {
    return typeof tag === "function" ? "function " + tag.name : JSON.stringify(tag);
  }
  export function jsx(tag: unknown, props: { children?: unknown }) {
    return show(tag) + "(" + [props.children ?? []].flat().join(" ") + ")";
  }
  export const jsxs = jsx;
  export const jsxDEV = jsx;
  export declare namespace JSX {
    type Element = string;
    interface IntrinsicElements {
      [name: string]: any;
    }
  }`;

const ways = [
  ["plain", [], ""],
  ["as one program", ["--aot"], "TestRunLayers:0"],
  ["over two layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
] as const;

async function runTestFile(name: string, files: Record<string, string>, flags: readonly string[], words: string) {
  using directory = tempDir(name, {
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "./jsx", "strict": true } }`,
    "jsx/jsx-runtime.ts": runtime,
    "jsx/jsx-dev-runtime.ts": runtime,
    ...files,
  });
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(directory), env);
  expect(stderr).not.toContain("TS100075");
  return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID "));
}

test.concurrent.each(ways)("an element named as an import is not the import: %s", async (_, flags, words) => {
  const files = {
    "names.ts": `
      export function html() { return "html"; }
      html.member = function member() { return ""; };
      export function div() { return "div"; }
      export function Html() { return ""; }`,
    "default.ts": `export default function title() { return "title"; }`,
    "a.test.tsx": `
      /** @jsxImportSource ./jsx */
      import { expectTypeOf } from "vitest";
      import title from "./default";
      import { html, div, Html } from "./names";
      import * as a from "./names";
      it("renders", () => {
        expectTypeOf(html()).toEqualTypeOf<string>();
        console.log("SAID", <html><div /><title></title><a /></html>);
        console.log("SAID", <html.member />, <Html></Html>, <a.Html />);
        console.log("SAID", html(), div(), title(), a.div());
      });`,
  };
  expect(await runTestFile("aot-lowercase-tags-imports", files, flags, words)).toEqual([
    `SAID "html"("div"() "title"() "a"())`,
    `SAID function member() function Html() function Html()`,
    `SAID html div title div`,
  ]);
});

test.concurrent.each(ways)(
  "an element named as a global of the test runner is not the global: %s",
  async (_, flags, words) => {
    const files = {
      "a.test.tsx": `
      /** @jsxImportSource ./jsx */
      it("renders", () => {
        console.log("SAID", <test />, <it></it>, <describe />, <expect />, <jest />, <vi />, <beforeAll />);
        console.log("SAID", typeof test, typeof it, typeof describe, typeof expect);
      });`,
    };
    expect(await runTestFile("aot-lowercase-tags-globals", files, flags, words)).toEqual([
      `SAID "test"() "it"() "describe"() "expect"() "jest"() "vi"() "beforeAll"()`,
      `SAID function function function function`,
    ]);
  },
);
