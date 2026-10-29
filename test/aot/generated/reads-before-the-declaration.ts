// A let, const or class binding that is read before its declaration has run throws a ReferenceError, whoever reads it and however the reader got to run.
// Each case makes a closure over the binding, gets it called ahead of the declaration in a way that does not look like a call of the closure to the function that declares, then behind it, and prints what both calls saw.
// The table: where and how the binding is declared x how the closure gets to run. The value rotates, two for each pair.
//
//   bun reads-before-the-declaration.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/dead-zone-<binding>.mjs.
import { writeCaseFiles, type CaseFile } from "./case-files";
import { keywordOf, mutators, type Mutator } from "./repeated-reads";

const values: { name: string; text: string }[] = [
  { name: "number", text: "7" },
  { name: "fraction", text: "0.5" },
  { name: "text", text: `"s"` },
  { name: "object", text: "{ p: 1 }" },
  { name: "function", text: "() => 3" },
];

interface Binding {
  name: string;
  /** `VALUE` stands for the value, `ACT` for the statements that get the closure called, `EXPRESSION` for the same as an expression. */
  text: string;
  /** What the closure is made behind, where the binding is not in the scope of the whole function. */
  scopeOpensAt?: string;
  /** The closure is called from an expression, where nothing can be awaited or yielded. */
  isSyncOnly?: true;
}

const bindings: Binding[] = [
  { name: "let", text: "ACT let v = VALUE; ACT" },
  { name: "const", text: "ACT const v = VALUE; ACT" },
  { name: "let-without-a-value", text: "ACT let v; ACT v = VALUE; ACT" },
  { name: "class", text: "ACT class v { static p = VALUE; } ACT" },
  { name: "destructured", text: "ACT const { v } = { v: VALUE }; ACT" },
  { name: "from-a-list", text: "ACT let [v] = [VALUE]; ACT" },
  { name: "stored-before-declared", text: `ACT try { v = VALUE; } catch (e) { got.push("store " + e.name); } ACT let v = VALUE; ACT` },
  { name: "in-a-block", text: "{ ACT let v = VALUE; ACT }", scopeOpensAt: "{ " },
  { name: "in-a-loop", text: "for (let i = 0; i < 2; i++) { ACT let v = VALUE; ACT }", scopeOpensAt: "{ " },
  { name: "in-a-loop-with-continue", text: "again: for (let i = 0; i < 3; i++) { ACT if (i === 1) continue again; let v = VALUE; ACT }", scopeOpensAt: "{ " },
  { name: "in-a-switch", text: "switch (never ? 0 : 1) { case 0: let v = VALUE; case 1: ACT v = VALUE; ACT }", scopeOpensAt: "case 1: " },
  { name: "in-a-try", text: `try { ACT let v = VALUE; ACT } finally { got.push("finally"); }`, scopeOpensAt: "{ " },
  { name: "after-a-throw", text: "try { ACT if (!never) throw 1; let v = VALUE; ACT } catch { ACT }", scopeOpensAt: "{ " },
  { name: "under-a-condition", text: "if (!never) { ACT } let v = VALUE; ACT" },
  { name: "in-its-own-initializer", text: "let v = (EXPRESSION, VALUE); ACT", isSyncOnly: true },
  { name: "in-its-own-initializer-const", text: "const v = [EXPRESSION, VALUE][1]; ACT", isSyncOnly: true },
  { name: "class-with-a-static-block", text: "class v { static p = VALUE; static { ACT } } ACT", isSyncOnly: true },
  { name: "class-heritage", text: "class v extends (EXPRESSION, Object) { static p = VALUE; } ACT", isSyncOnly: true },
  { name: "class-member-name", text: `class v { static [(EXPRESSION, "p")] = VALUE; } ACT`, isSyncOnly: true },
  { name: "class-static-field", text: "class v { static q = EXPRESSION; static p = VALUE; } ACT", isSyncOnly: true },
  { name: "loop-keeps-the-first-closure", text: "let first; for (let i = 0; i < 2; i++) { ACT first ??= change; first(); let v = VALUE; ACT first(); }", scopeOpensAt: "{ " },
  { name: "destructuring-default", text: "const { w = EXPRESSION, v = VALUE } = {}; ACT", isSyncOnly: true },
  { name: "second-of-two", text: "let u = EXPRESSION, v = VALUE; ACT", isSyncOnly: true },
];

const makeClosure = `change = () => { try { got.push(typeof v === "object" ? JSON.stringify(v) : typeof v === "function" ? "function" : v); } catch (e) { got.push(e.name); } };`;

function caseOf(binding: Binding, mutator: Mutator, value: (typeof values)[number]) {
  const text = binding.text.replaceAll("VALUE", value.text).replaceAll("EXPRESSION", `(() => { ${mutator.act} })()`).replaceAll("ACT", mutator.act);
  const body = binding.scopeOpensAt ? text.replace(binding.scopeOpensAt, () => `${binding.scopeOpensAt}${makeClosure} `) : `${makeClosure} ${text}`;
  const drive = { "sync": "run();", "async": "await run();", "generator": "for (const step of run()) change();", "generator-alone": "for (const step of run());", "async-generator": "for await (const step of run()) change();" }[
    mutator.reader
  ];
  const name = `${binding.name} ${mutator.name} ${value.name}`;
  return { name, line: `await t("${name}", async () => { let change = () => {}; const got = []; ${mutator.setup} ${keywordOf[mutator.reader]} run() { ${body} } ${drive} return got; });` };
}

const head = `// A binding read before its declaration has run throws a ReferenceError, however the reader got to run.
const never = process.argv.length > 99;
let sink;
const show = v => JSON.stringify(v, (key, each) => each === undefined ? "undefined" : each);
async function t(name, f) { let r; try { r = show(await f()); } catch (e) { r = "threw " + e.name; } console.log(name, r); }
`;

export const caseFiles = (): CaseFile[] =>
  bindings.map((binding, i) => ({
    name: `dead-zone-${binding.name}.mjs`,
    head,
    cases: mutators.flatMap((mutator, j) => (binding.isSyncOnly && mutator.reader !== "sync" ? [] : [0, 2].map(k => caseOf(binding, mutator, values[(i + j + k) % values.length])))),
  }));

if (import.meta.main) writeCaseFiles(caseFiles());
