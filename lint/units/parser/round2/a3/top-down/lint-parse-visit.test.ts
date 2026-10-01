import { Glob } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// With debug assertions, BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT makes the parse pass of Parser::parse a lint parse.
const root = join(import.meta.dir, "..", "..", "..");
// A missing parameter type: a parse without lint takes it, a lint parse does not.
const sentinel = "let x: (a: ) => void;\n";
const configNames = ["", " (experimental decorators with metadata)", " (minified)"];
const shardCount = 2;

// What no file of the corpus has: each reaches a path of a lint parse that the files do not reach.
const sources: ["ts" | "tsx", string][] = [
  ["tsx", `const a = <Foo<string> value="x" />;\nconst b = <Foo<A, B>>text</Foo>;\nconst c = <ns.Foo<A> {...p} />;\n`],
  ["ts", `const f = async <T,>(x: T) => x;\nconst g = async <T>(x: T): Promise<T> => x;\n`],
  ["ts", `const h = async <T extends object = {}>(x: T, ...r: T[]) => { await x; };\n`],
  ["tsx", `const f = async <T,>(x: T) => x;\nconst g = async <T extends object>(x: T): Promise<T> => x;\n`],
  ["ts", `declare function async<T>(x: T): T;\nasync<number>(1);\nasync<A, B>(a, b);\nasync < a > (b);\n`],
  ["ts", `a?.<T>(b);\na?.b<T>(c);\na?.[0]<T>(d);\n`],
  ["ts", `@x<y>() class A {}\n@x.y<z>() class B { @m<T>() n() {} }\n`],
  [
    "ts",
    `import a = require("a");\nimport b = a.b;\nexport import c = a.c;\nimport type d = require("d");\nconsole.log(b);\n`,
  ],
  ["ts", `export default interface I { a: string }\n`],
  ["ts", `export default function g(): void;\nexport default function g(a?: number): void {}\n`],
  [
    "ts",
    `export default async function f(): Promise<void>;\nexport default async function f(a?: number): Promise<void> {}\n`,
  ],
  ["ts", `export default abstract class C { abstract m(): void; n() {} }\n`],
  ["ts", `type A = 1; type B = 2;\nexport type { A };\nexport { type B };\nexport type { C } from "./c";\n`],
  ["ts", `export type * from "./d";\nexport type * as e from "./e";\nexport { type F, g } from "./f";\n`],
  [
    "ts",
    `import type X from "x";\nimport type { Y } from "y";\nimport type * as Z from "z";\nimport { type P, q } from "p";\nq();\n`,
  ],
  ["ts", `class C implements A.B<T>, D {}\nclass E extends F<G> implements H {}\nclass I extends (J as any)<K> {}\n`],
  ["ts", `type X<T> = T extends (infer U extends string ? 1 : 2) ? U : never;\n`],
  ["ts", `type Y<T> = T extends [infer H extends string, ...infer R] ? H : never;\n`],
  [
    "ts",
    `let a: (x = 1) => void;\nlet b: { [Symbol.iterator](): void; [k: string]: any; get g(): number; set g(v) };\n`,
  ],
  ["ts", `let c: typeof import("x");\nlet d: import("y").T<string>;\nlet e: typeof a<number>;\n`],
  ["ts", `const v = <T>(x);\nconst w = <const>["a"];\nconst z = <T,>(x: T) => x;\nconst y = <T>(x: T): T => x;\n`],
  ["ts", `const u = <any>function () {};\nconst t = <A<B>>c;\n`],
  ["ts", `const r = a ? (b): c => d : e;\nconst s = a ? (b) : c => d;\nconst q = a ? (b, c) : (d): e => f;\n`],
  [
    "ts",
    `a!.b!()!;\n(a as any)!.b;\nx satisfies T as U;\n(<T>y)!;\nconst k = [1, 2] as const;\n(a as b) = c;\n(<b>a) = c;\na! = b;\n`,
  ],
  ["ts", `const m = Map<string, number>;\nf<T>;\nnew X<T>;\nnew X<T>(1);\ng<T>\`x\`;\nh<A, B>?.(1);\n`],
  [
    "ts",
    `const f1 = ({ a, b }: P = {}) => a;\nconst f2 = async (x: T): Promise<T> => x;\nconst f5 = (a): a is string => true;\n`,
  ],
  [
    "ts",
    `const f3 = (a?: number, ...rest: string[]) => {};\nconst f4 = ([a, b]: [number, string], { c }: { c?: number } = {}) => a;\n`,
  ],
  [
    "tsx",
    `const id = <T,>(x: T) => x;\nconst id2 = <T extends object>(x: T) => x;\nconst el = <div>{(x as any) satisfies unknown}</div>;\n`,
  ],
  [
    "ts",
    `abstract class A<in out T> extends B<T> implements I<T>, J {\n  constructor(private readonly x: T, public y?: string) { super(); }\n` +
      `  static #p: number = 1;\n  declare w: string;\n  abstract n(): void;\n  [key: string]: any;\n  m?(): void;\n  o!: number;\n` +
      `  get g(): T { return this.x; }\n  set g(v: T) {}\n  m2(a: number): void;\n  m2(a: any) {}\n  static { this.#p = 2; }\n  accessor q = 1;\n}\n`,
  ],
  [
    "ts",
    `type M<T> = { readonly [K in keyof T as \`on\${Capitalize<K & string>}\`]?: T[K] extends infer U extends string ? U : never };\n`,
  ],
  [
    "ts",
    `declare const u: unique symbol;\ntype N = readonly [a: string, b?: number, ...c: boolean[]];\ntype O = abstract new <T>(a: T) => T;\n`,
  ],
  [
    "ts",
    `function isS(x: unknown): x is string { return true; }\nfunction assert(x: unknown): asserts x is string {}\n`,
  ],
  [
    "ts",
    `function a2(this: Foo, x: unknown): asserts this is Bar {}\nfunction over(a: number): void;\nfunction over(a: any) {}\n`,
  ],
  [
    "ts",
    `for (const x of y as T[]) {}\ntry {} catch (e: unknown) {}\nlet d1!: number, d2: string | undefined = undefined;\n`,
  ],
  [
    "ts",
    `const enum E { A = 1, B = A << 1 }\ndeclare enum F { X }\nenum G { a = "x".length, b }\nconsole.log(E.B, G.b);\n`,
  ],
  ["ts", `namespace N1.N2 { export const a = 1; export declare const b: number; export function c() { return b; } }\n`],
  [
    "ts",
    `declare namespace D { let x: number; }\ndeclare module "m" { export const y: string; }\ndeclare global { interface Window { z: number } }\n`,
  ],
  ["ts", `type as = 1;\ninterface as {}\nlet type = 1, declare = 2, namespace = 3, module = 4, abstract = 5;\ntype;\n`],
  ["ts", `const o = { m<T>(this: void, a: T): T { return a; }, get g(): number { return 1; }, [k as string]: 1 };\n`],
  ["ts", `export as namespace NS;\nexport = foo;\n`],
  [
    "ts",
    `let x1: A | B extends C ? D : E;\nlet x3: (new () => A)[] | (() => void)[];\nlet x4: A<B<C<D>>>;\nlet x5: A<B<C>>= d;\nlet x7 = a<b>>c;\n`,
  ],
  [
    "ts",
    `class S {\n  constructor(@inject() private a: A, @opt() b?: B) {}\n  @m() run(@p() x: number, y: string | undefined): Promise<void> { return null!; }\n` +
      `  @f() f1: Map<string, number>;\n  @f() f2: typeof S;\n  @f() f3?: A.B.C;\n  @f() f4: (a = 1) => void;\n  @f() f5: { [Symbol.iterator](): void };\n}\n`,
  ],
  [
    "ts",
    `@c() class T<U> {\n  constructor(a: U, b: T<U>, c: typeof import("x"), d: import("y").Z, e: U extends string ? 1 : 2) {}\n` +
      `  @m() n(this: T<U>, a: keyof U, b: U[], c: readonly string[], d: \`a\${string}\`): asserts a is never {}\n  @f() declare p: number;\n}\n`,
  ],
];

const worker = String.raw`
const fs = require("node:fs");
const [listPath, outPath] = process.argv.slice(2);
const { root, sentinel, sources, files, withCode } = JSON.parse(fs.readFileSync(listPath, "utf8"));
const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const options = [{}, { tsconfig }, { minify: { whitespace: true, syntax: true, identifiers: true } }];
const transpilers = options.map(o => ({
  ts: new Bun.Transpiler({ loader: "ts", ...o }),
  tsx: new Bun.Transpiler({ loader: "tsx", ...o }),
}));
const out = fs.openSync(outPath, "w");
const stamp = bytes => bytes.length + ":" + Bun.hash(bytes);
function transform(i, c, loader, source) {
  // The line before the result names the file that a crash is in.
  fs.writeSync(out, JSON.stringify({ start: i, c }) + "\n");
  let result;
  try {
    const code = transpilers[c][loader].transformSync(source);
    result = withCode ? { out: stamp(code), code } : { out: stamp(code) };
  } catch (e) {
    result = { errors: (e?.errors ?? [e]).map(error => String(error?.message ?? error)) };
  }
  fs.writeSync(out, JSON.stringify({ i, c, src: stamp(source), ...result }) + "\n");
}
transform(-1, 0, "ts", sentinel);
sources.forEach(([loader, text], k) => [0, 1, 2].forEach(c => transform(-2 - k, c, loader, text)));
for (const [i, file] of files) {
  let source;
  try {
    source = fs.readFileSync(root + "/" + file);
  } catch {
    continue;
  }
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  transform(i, 0, loader, source);
  // A line that starts with a decorator: once more with experimental decorators and their metadata.
  if (/^[ \t]*@[A-Za-z_$(]/m.test(source.latin1Slice())) transform(i, 1, loader, source);
  transform(i, 2, loader, source);
}
fs.closeSync(out);
`;

type Result = { i: number; c: number; src: string; out?: string; code?: string; errors?: string[] };

let listed: string[] | undefined;
function corpus(): string[] {
  if (listed) return listed;
  const files: string[] = [];
  for (const dir of ["src/js", "test"]) {
    for (const file of new Glob("**/*.{ts,tsx,mts,cts}").scanSync({ cwd: join(root, dir) })) {
      const path = `${dir}/${file.replaceAll("\\", "/")}`;
      // An installed package is no part of the claim.
      if (!path.split("/").includes("node_modules")) files.push(path);
    }
  }
  return (listed = files.sort());
}

const counts = { files: 0, sources: 0, equal: 0, rejectedByBoth: 0, changedWhileRead: 0 };

async function run(dir: string, name: string, list: object, lint: boolean) {
  await Bun.write(
    join(dir, `${name}.list.json`),
    JSON.stringify({ root, sentinel, sources: [], withCode: false, ...list }),
  );
  await using proc = Bun.spawn({
    cmd: [bunExe(), "worker.js", `${name}.list.json`, `${name}.jsonl`],
    cwd: dir,
    env: lint ? { ...bunEnv, BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT: "1" } : bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let text = "";
  try {
    text = readFileSync(join(dir, `${name}.jsonl`), "utf8");
  } catch {}
  const results = new Map<string, Result>();
  let last: { start?: number; c: number } | undefined;
  for (const line of text.split("\n")) {
    if (!line) continue;
    last = JSON.parse(line);
    if (last!.start === undefined) results.set(`${(last as Result).i} ${last!.c}`, last as Result);
  }
  const crash =
    exitCode === 0 && last && last.start === undefined
      ? undefined
      : {
          child: name,
          exitCode,
          signalCode: proc.signalCode,
          at: last?.start === undefined ? "outside a file" : nameOf(last.start, last.c),
          stderr: stderr.slice(-4000),
        };
  return { results, crash };
}

function nameOf(i: number, c: number) {
  const name =
    i === -1 ? "the sentinel" : i < -1 ? `source ${-2 - i}: ${JSON.stringify(sources[-2 - i][1])}` : corpus()[i];
  return `${name}${configNames[c]}`;
}

describe.skipIf(!isDebug && !isASAN)("a lint parse, visited and printed", () => {
  afterAll(() => {
    console.log(
      `lint parse, visited and printed: ${counts.equal} results of ${counts.files} files and ${counts.sources} sources equal,` +
        ` ${counts.rejectedByBoth} rejected by both, ${counts.changedWhileRead} changed while read`,
    );
  });

  test.concurrent.each(Array.from({ length: shardCount }, (_, shard) => shard))(
    "is the normal transpile of every TypeScript file under test/ and src/js, shard %d",
    async shard => {
      const names = corpus();
      // Nearly every file is there: an empty list would pass every comparison below.
      expect(names.length).toBeGreaterThan(3000);
      const files = names.map((file, i) => [i, file] as [number, string]).filter(([i]) => i % shardCount === shard);
      const list = { files, sources: shard === 0 ? sources : [] };
      using dir = tempDir(`lint-parse-visit-${shard}`, { "worker.js": worker });
      const [normal, lint] = await Promise.all([
        run(String(dir), "normal", list, false),
        run(String(dir), "lint", list, true),
      ]);

      const differing: Result[] = [];
      const rejectedOnlyByLint: unknown[] = [];
      const rejectedOnlyWithoutLint: unknown[] = [];
      let equal = 0;
      for (const [key, n] of normal.results) {
        const l = lint.results.get(key);
        if (n.i === -1 || !l) continue;
        if (n.src !== l.src) counts.changedWhileRead++;
        else if (n.out !== undefined && l.out !== undefined) {
          if (n.out === l.out) equal++;
          else differing.push(n);
        } else if (n.out !== undefined) rejectedOnlyByLint.push({ file: nameOf(n.i, n.c), errors: l.errors });
        else if (l.out !== undefined) rejectedOnlyWithoutLint.push({ file: nameOf(n.i, n.c), errors: n.errors });
        else counts.rejectedByBoth++;
      }
      counts.files += files.length;
      counts.sources += list.sources.length;
      counts.equal += equal;

      // Where the bytes differ, the first files are transpiled again for their text, to show where.
      const shown: unknown[] = differing.map(n => nameOf(n.i, n.c));
      if (differing.length > 0) {
        const again = {
          files: differing
            .filter(n => n.i >= 0)
            .slice(0, 3)
            .map(n => [n.i, names[n.i]]),
          withCode: true,
        };
        const a = await run(String(dir), "normal-again", again, false);
        const b = await run(String(dir), "lint-again", again, true);
        for (const [key, n] of a.results) {
          const l = b.results.get(key);
          if (n.code === undefined || l?.code === undefined || n.code === l.code) continue;
          let at = 0;
          while (n.code[at] === l.code[at]) at++;
          const [from, to] = [Math.max(0, at - 80), at + 80];
          shown.push({ file: nameOf(n.i, n.c), at, normal: n.code.slice(from, to), lint: l.code.slice(from, to) });
        }
      }

      // A child that died names the file it was in: the visit pass panics on a scope that the parse pass did not record.
      expect([normal.crash, lint.crash].filter(Boolean)).toEqual([]);
      // Each child proves its own mode.
      const [n, l] = [normal.results.get("-1 0"), lint.results.get("-1 0")];
      expect({ normal: n?.out !== undefined, lint: l?.errors !== undefined }).toEqual({ normal: true, lint: true });
      expect({ differing: shown, rejectedOnlyByLint, rejectedOnlyWithoutLint }).toEqual({
        differing: [],
        rejectedOnlyByLint: [],
        rejectedOnlyWithoutLint: [],
      });
      // Nearly every file parses, plain and minified.
      expect(equal).toBeGreaterThan(files.length * 2 * 0.99);
    },
    600_000,
  );
});
