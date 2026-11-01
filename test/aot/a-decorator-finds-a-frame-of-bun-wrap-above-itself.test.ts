// Plain Bun applies decorators through functions of its module bun:wrap, so a decorator that looks at `new Error().stack` finds one frame of bun:wrap above itself and the
// file of the class right behind it. @mikro-orm/decorators has code written for Bun that goes by it: "Native ES decorators expose the entity path right after `bun:wrap`".
// Compiled code said "(native)" there, and nothing at all for a legacy decorator of a member, so mikro-orm did not find the file of an entity.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// The decorator, the helper and the file behind it. The name of a function of bun:wrap is Bun's own business, and so is what else of the file stands further up.
const frames = `
  const file = (name: string | null | undefined) => (name ? name.replace(/^.*\\//, "") : String(name));
  export const seen: string[] = [];
  export function look(kind: string) {
    const text = new Error().stack!.split("\\n").slice(2, 5).map((line, i) => { const m = /^\\s*at (?:(.*?) \\()?(.*?)(?::\\d+:\\d+)?\\)?$/.exec(line)!; return (i ? "" : (m[1] ?? "")) + "@" + file(m[2]); });
    const keep = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, sites) => sites.slice(1, 4).map((s, i) => (i ? "" : (s.getFunctionName() ?? "")) + "@" + file(s.getFileName()) + (s.isNative() ? "!native" : "") + (typeof s.getLineNumber() === "number" ? "" : "!noline") + "/" + file(s.getScriptNameOrSourceURL()));
    const sites = new Error().stack as unknown as string[];
    const holder: { stack?: string[] } = {}; Error.captureStackTrace(holder);
    Error.prepareStackTrace = keep;
    seen.push(kind + " | " + text.join(" < ") + " | " + sites.join(" < ") + " | " + holder.stack!.join(" < "));
  }`;
const asTest = `import { test } from "bun:test";\nimport "./body";\nimport { seen } from "./frames";\ntest("x", () => { for (const line of seen) console.log("SAID", line); });`;
const asProgram = `import "./body";\nimport { seen } from "./frames";\nfor (const line of seen) console.log("SAID", line);`;

const projects: Record<string, Record<string, string>> = {
  "standard decorators": {
    "tsconfig.json": `{ "compilerOptions": { "target": "esnext", "strict": true } }`,
    "body.ts": `
      import { look } from "./frames";
      const d = (kind: string) => (value: unknown, context: DecoratorContext) => { look(kind + ":" + context.kind); };
      @d("class")
      class Task {
        @d("field") title = "t";
        @d("static field") static count = 0;
        @d("method") run() {}
        @d("static method") static make() {}
        @d("getter") get size() { return 1; }
        @d("setter") set size(v: number) {}
        @d("accessor") accessor auto = 1;
        @d("private method") #hidden() {}
        @d("private field") #secret = 1;
      }
      const Expression = @d("class expression") class {};
      export const made = [new Task().title, typeof Expression];`,
  },
  "legacy decorators": {
    "tsconfig.json": `{ "compilerOptions": { "target": "esnext", "strict": true, "experimentalDecorators": true } }`,
    "body.ts": `
      import { look } from "./frames";
      const onClass = (target: Function) => { look("class"); };
      const onMember = (kind: string) => (target: object, key: string | symbol, descriptor?: PropertyDescriptor) => { look(kind); };
      const onParameter = (target: object, key: string | symbol | undefined, index: number) => { look("parameter"); };
      @onClass
      class Task {
        @onMember("property") title = "t";
        @onMember("static property") static count = 0;
        @onMember("method") run(@onParameter first: number) {}
        @onMember("static method") static make() {}
        @onMember("accessor") get size() { return 1; }
        constructor(@onParameter first?: number) {}
      }
      export const made = new Task().title;`,
  },
  // The compiler has functions of its own for these too, and their frames stand for the built-in that the program wrote.
  "what stands for a built-in is native code as before": {
    "tsconfig.json": `{ "compilerOptions": { "target": "esnext", "strict": true } }`,
    "body.ts": `
      import { look } from "./frames";
      export const made = [
        Array(2).fill(0).map(() => look("map of a filled list")),
        Array.from({ length: 2 }, () => look("from a length")),
        Array.from([1, 2], () => look("from a list")),
        [1, 2].map(() => look("map")),
        [1, 2].forEach(() => look("forEach")),
        [1, 2].filter(() => (look("filter"), true)),
        [2, 1].sort((a, b) => (look("sort"), a - b)),
        [2, 1].toSorted((a, b) => (look("toSorted"), a - b)),
        [1, 2].values().forEach(() => look("forEach of an iterator")),
      ].length;`,
  },
};

for (const [title, files] of Object.entries(projects)) {
  test(title, async () => {
    using dir = tempDir("a-decorator-finds-a-frame-of-bun-wrap", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "frames.ts": frames,
      "a.test.ts": asTest,
      "main.ts": asProgram,
      ...files,
    });
    const said = async (words: string | undefined, ...cmd: string[]) => {
      const { stdout, stderr, exitCode } = await run(cmd, String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words });
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return stdout.split("\n").filter(line => line.startsWith("SAID"));
    };
    const plain = await said(undefined, bunExe(), "test");
    expect(plain.length).toBeGreaterThan(7);
    const above = plain.map(line =>
      line
        .split(" | ")
        .slice(1)
        .map(part => part.split(" < ")[1]),
    );
    if (title.endsWith("decorators"))
      for (const helper of above) expect(helper).toEqual(["@bun:wrap", "@bun:wrap/bun:wrap", "@bun:wrap/bun:wrap"]);
    else expect(above.flat().filter(frame => frame?.includes("bun:wrap"))).toEqual([]);
    expect(await said("TestRunLayers:0", bunExe(), "test", "--aot")).toEqual(plain);
    expect(await said("TestRunLayers:3,TestRunPartFiles:1", bunExe(), "test", "--aot", "--isolate")).toEqual(plain);
    expect(await said(undefined, bunExe(), "main.ts")).toEqual(plain);
    await said(undefined, bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "built");
    expect(await said(undefined, join(String(dir), "built"))).toEqual(plain);
  });
}
