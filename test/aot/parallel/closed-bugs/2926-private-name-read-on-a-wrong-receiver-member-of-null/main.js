import { tell } from "./tell.js";
function name(o) { return o.x; }
function deep(o) { return o.p.q; }
function index(o) { return o[0]; }
function key(o, k) { return o[k]; }
function call(o) { return o.x(); }
function viaThis() { return this.x; }
function local() { const holder = null; return holder.x; }
function result(f) { return f().x; }
function store(o) { o.x = 1; }
tell({
  "o.x of null": () => name(null),
  "o.x of undefined": () => name(undefined),
  "o.p.q": () => deep({ p: null }),
  "o[0]": () => index(null),
  "o[k]": () => key(undefined, "name"),
  "o.x()": () => call(null),
  "this.x": () => viaThis.call(undefined),
  "holder.x": () => local(),
  "f().x": () => result(() => null),
  "o.x = 1": () => store(null),
});
