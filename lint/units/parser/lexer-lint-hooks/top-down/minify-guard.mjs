const z = "z".repeat(400);
const cases = {
  in_tag_block: `export function f(){ let longName = 1; return <div /* ${z} */ id="x">{longName}</div>; }`,
  in_tag_line: `export function f(){ let longName = 1; return <div // ${z}\n id="x">{longName}</div>; }`,
  outside_block: `export function f(){ let longName = 1; /* ${z} */ return <div id="x">{longName}</div>; }`,
  outside_line: `export function f(){ let longName = 1; // ${z}\n return <div id="x">{longName}</div>; }`,
  in_braces: `export function f(){ let longName = 1; return <div id="x">{/* ${z} */ longName}</div>; }`,
  in_attr_braces: `export function f(){ let longName = 1; return <div id={/* ${z} */ "x"}>{longName}</div>; }`,
  in_close_tag: `export function f(){ let longName = 1; return <div id="x">{longName}</div /* ${z} */>; }`,
  in_self_close: `export function f(){ let longName = 1; return <div id="x" /* ${z} */ />; }`,
  after_tag_name: `export function f(){ let longName = 1; return <div/* ${z} */>{longName}</div>; }`,
  before_tag_name: `export function f(){ let longName = 1; return </* ${z} */div>{longName}</div>; }`,
};
for (const [name, code] of Object.entries(cases)) {
  try {
    const t = new Bun.Transpiler({ loader: "jsx", minify: { identifiers: true }, target: "browser" });
    const out = t.transformSync(code);
    const m = out.match(/let (\w+)\s*=\s*1/);
    console.log(name.padEnd(18), "local =", m ? m[1] : "?", "|", out.replace(/\s+/g, " ").slice(0, 110));
  } catch (e) {
    console.log(name.padEnd(18), "ERR", String(e?.message ?? e).slice(0, 100));
  }
}
