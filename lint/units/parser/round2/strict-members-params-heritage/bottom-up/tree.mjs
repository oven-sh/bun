const ts = (await import("/workspace/wt/parser/node_modules/typescript/lib/typescript.js")).default;
const t = new Bun.Transpiler({ loader: "ts" });
for (const s of [
  "class C { public\n x }", "class C { private\n x = 1 }", "class C { protected\n x: number }", "class C { readonly\n x }", "class C { override\n x }",
  "class C { static\n x }", "class C { declare\n x }", "class C { abstract\n x }", "class C { accessor\n x }", "class C { async\n m() {} }",
  "class C { get\n a() { return 1 } }", "class C { public static\n x }", "class C { static public\n x }", "class C { public\n static x }",
  "class C { constructor(public\n a) {} }", "class C { const\n x = 1; }", "class C { m!() {} }", "class C { get a?() { return 1 } }", "class C { constructor?() {} }",
  "class C { [k!: string]: any; x = 1 }", "class C { get [k: string]: any; x = 1 }",
]) {
  let b; try { b = t.transformSync(s).trim().replace(/\s+/g, " "); } catch (e) { b = "ERR " + (e.errors?.[0]?.message ?? e.message); }
  const sf = ts.createSourceFile("a.ts", s, ts.ScriptTarget.Latest, true);
  const cls = sf.statements[0];
  const members = cls.members ? cls.members.map(m => ts.SyntaxKind[m.kind] + "(" + (m.modifiers || []).map(x => x.getText(sf)).join(" ") + "|" + (m.name ? m.name.getText(sf) : "") + ")").join(", ") : "";
  console.log(JSON.stringify(s), "\n   bun:", b, "\n   tsc:", sf.parseDiagnostics.length ? "ERR TS" + sf.parseDiagnostics[0].code : members);
}
