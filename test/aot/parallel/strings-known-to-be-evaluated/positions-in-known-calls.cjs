// The places of what goes wrong in a direct eval of a known call count in its string, from 1.
const show = e => console.log(e.message, String(e.stack).split("\n")[1].replace(/\(?(file:\/\/)?[^ (]*\/([^/ ]*:\d+:\d+)\)?/, "$2").replace(/\.cjs|prog|[a-z-]+(?=:\d)/g, ""));
function g() {}
const all = [
  () => eval("nope()"),
  () => eval("g(1, nope2)"),
  () => eval("g(nope())"),
  () => eval("nope.x()"),
  () => eval("g.x.y()"),
  () => eval("g.x()"),
  () => eval("g(\n  nope(),\n  2)"),
  () => eval("g(g, g(\n\n missing))"),
  () => eval("(function () { return nope(); })")(),
];
for (const f of all) try { f(); } catch (e) { show(e); }
