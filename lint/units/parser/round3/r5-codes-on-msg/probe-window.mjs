// Does the statement parser take a declaration at the offset of the token that failed? The text before the token is
// parsed again with `const _=0;if(0);` after it: no error inside that text means a statement of a list starts there.
const PROBE = "const _=0;if(0);";
const rows = [
  // [loader, source, offset of the failing token, a statement of a list starts there (what the reference implies)]
  ["ts", ")", 0, true], ["js", "{ ) }", 2, true], ["ts", "function f() { default }", 15, true], ["ts", "default", 0, true],
  ["ts", "catch (e) {}", 0, true], ["ts", "x = 1\n)", 6, true], ["ts", "foo();\n}", 7, true], ["ts", "function f() {}\n}", 16, true],
  ["ts", "a: { ) }", 5, true], ["ts", "switch (x) { case 1: ) }", 21, true], ["ts", "class A { static { ) } }", 19, true],
  ["ts", "namespace N { ) }", 14, true], ["ts", "() => { ) }", 8, true], ["tsx", "const f = () => { ) }", 18, true],
  ["ts", "if (x) )", 7, false], ["ts", "let x = ;", 8, false], ["ts", "x = 1 +", 7, false], ["ts", "for ()", 5, false],
  ["ts", "for (;)", 6, false], ["ts", "for (;;) )", 9, false], ["ts", "while (x) )", 10, false], ["ts", "a ? (b): ;", 9, false],
  ["ts", "return )", 7, false], ["ts", "f() )", 4, null], ["ts", "`${ )`", 4, false], ["tsx", "let a = <div>{ )}</div>", 15, false],
  ["ts", "x = [ ) ]", 6, false], ["ts", "do )", 3, false], ["ts", "if (a) b; else )", 15, false], ["ts", "label: )", 7, false],
  ["ts", "class A implements ) {}", 19, false], ["ts", "export default )", 15, false], ["ts", "throw )", 6, false],
  ["ts", "x = () => )", 10, false], ["ts", "with (a) )", 9, false],
];
let bad = 0;
for (const [loader, source, offset, expected] of rows) {
  const text = source.slice(0, offset) + PROBE;
  let errors = [];
  try { new Bun.Transpiler({ loader }).scanImports(text); } catch (e) { errors = (e?.errors ?? [e]).map(x => [x.position?.offset ?? -1, x.message]); }
  const inside = errors.filter(([at]) => at >= offset && at < offset + PROBE.length);
  const isList = inside.length === 0;
  let first = [];
  try { new Bun.Transpiler({ loader }).scanImports(source); } catch (e) { first = (e?.errors ?? [e]).map(x => `@${x.position?.offset}+${x.position?.length} ${x.message}`); }
  const verdict = expected === null ? "n/a " : isList === expected ? "ok  " : "BAD ";
  if (verdict === "BAD ") bad++;
  console.log(verdict, JSON.stringify(source), "[" + loader + "]", "first:", first[0] ?? "ACCEPTS", "| probe:", isList ? "list" : "no (" + inside.map(([at, m]) => `@${at} ${m}`).join("; ") + ")");
}
console.log(bad, "rows differ from what was expected;", Bun.version, Bun.revision);
