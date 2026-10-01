const cases = [
  ["block-header", "/** @jsx h */\nlet e = <a/>;"],
  ["line-header", "// @jsx h\nlet e = <a/>;"],
  ["block-after-first-token", "let y;\n/** @jsx h */\nlet e = <a/>;"],
  ["upper-case-name", "/** @JSX h */\nlet e = <a/>;"],
  ["hash-trigger", "/** #jsx h */\nlet e = <a/>;"],
  ["second-at-on-line", "/** foo@x @jsx h */\nlet e = <a/>;"],
  ["two-pragmas-last-wins", "/* @jsx h */ /* @jsx g */\nlet e = <a/>;"],
  ["value-on-next-line", "/** @jsx\n h */\nlet e = <a/>;"],
  ["colon-after-name", "/** @jsx: h */\nlet e = <a/>;"],
  ["frag", "/** @jsx h */\n/** @jsxFrag F */\nlet e = <></>;"],
  ["frag-lower", "/** @jsx h */\n/** @jsxfrag F */\nlet e = <></>;"],
  ["inside-jsx-tag", "let e = <a /* @jsx h */ />;"],
  ["value-then-star-slash", "/*@jsx h*/\nlet e = <a/>;"],
];
const t = new Bun.Transpiler({ loader: "tsx", tsconfig: { compilerOptions: { jsx: "react" } } });
for (const [name, src] of cases) {
  let out;
  try { out = t.transformSync(src).trim().split("\n").filter(l => l.includes("let e")).join(" | "); } catch (e) { out = "ERROR " + String(e.message).split("\n")[0]; }
  console.log(name.padEnd(26), JSON.stringify(out));
}
console.log(Bun.version, Bun.revision);
