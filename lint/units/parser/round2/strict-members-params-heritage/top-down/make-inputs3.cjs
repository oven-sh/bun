// usage: node make-inputs3.cjs > inputs3.json   where a line break stands after a modifier, and other cases that both parsers take
const out = [];
const g = (group, list, l) => { for (const s of list) out.push(l ? { g: group, s, l } : { g: group, s }); };
const mods = ["public", "private", "protected", "readonly", "override", "static", "declare", "abstract", "accessor", "async", "get", "set"];
const tails = ["x = 1", "x", "x: number", "m() {}", "[k] = 1", "'s' = 1", "1 = 1", "#p = 1", "*g() {}", "static y = 1", "readonly z = 1", "constructor() {}", "[k: string]: any"];
const list = [];
for (const m of mods) for (const t of tails) {
  const body = m === "set" && /\(\)/.test(t) ? t.replace("()", "(v)") : t;
  list.push(`class C { ${m}\n ${body} }`);
}
g("n a line break after a modifier of a class member", list);
g("n a line break after two modifiers", [
  "class C { public static\n x = 1 }", "class C { static public\n x = 1 }", "class C { public\n static\n x = 1 }", "class C { static\n public\n x = 1 }",
  "class C { public readonly\n x = 1 }", "class C { static readonly\n x = 1 }", "class C { static async\n m() {} }", "class C { static get\n x() { return 1 } }",
  "class C { static\n get x() { return 1 } }", "class C { static\n async m() {} }", "class C { static\n *g() {} }", "class C { static\n{ } }", "class C { static\n[k] = 1 }",
  "class C { public /* c */ x = 1 }", "class C { public // c\n x = 1 }", "class C { public /* a\n b */ x = 1 }", "class C { readonly\n}", "class C { public\n;x }",
  "abstract class C { abstract\n m(): void }", "abstract class C { public abstract\n m(): void }", "class C { declare\n readonly x: number }", "class C { accessor\n static x = 1 }",
  "class C { @dec\n public\n x = 1 }", "class C { @dec public\n x = 1 }", "class C { override\n m() {} }", "class C { async\n *g() {} }", "class C { get\n *g() {} }",
  "class C { static\n static }", "class C { static\n static x }", "class C { static static\n x }", "class C { public\n public }", "class C { readonly\n readonly: number }",
]);
g("n the same words in an object literal and in parameters", [
  "({ get\n x() { return 1 } })", "({ async\n x() {} })", "({ static\n x() {} })", "function f(public\n x) {}", "class C { m(public\n x) {} }",
]);
g("n JavaScript", ["class C { static\n x = 1 }", "class C { async\n m() {} }", "class C { get\n x() { return 1 } }", "class C { accessor\n x = 1 }", "class C { public\n x = 1 }"], "js");
process.stdout.write(JSON.stringify(out, null, 0));
