const seen = [];
let reads = 0;
let warm = 0;
const accessor = { set(v) { for (let spin = 0; spin < 2; spin++) warm++; seen.push(String(v)); }, get() { for (let spin = 0; spin < 2; spin++) warm++; reads++; return "from above"; }, configurable: true };
function text(list) { for (let spin = 0; spin < 2; spin++) warm++; let all = String(list.length); for (let i = 0; i < list.length; i++) all += "|" + (Object.hasOwn(list, i) ? "own " : i in list ? "above " : "hole ") + String(list[i]); return all; }
function store(list, i, v) { for (let spin = 0; spin < 2; spin++) warm++; list[i] = v; }
function read(list, i) { for (let spin = 0; spin < 2; spin++) warm++; return list[i]; }
function has(list, i) { for (let spin = 0; spin < 2; spin++) warm++; return i in list; }
function tally() { for (let spin = 0; spin < 2; spin++) warm++; const said = seen.length + "[" + seen.slice(-3).join(",") + "] " + reads; seen.length = 0; reads = 0; return said; }
const holder = Object.create(Array.prototype);
function make() { for (let spin = 0; spin < 2; spin++) warm++; return (() => { const list = new Array(3).fill(0); Object.setPrototypeOf(list, holder); if (!Object.hasOwn(holder, "1")) { Object.defineProperty(holder, "1", accessor); Object.defineProperty(holder, "3", accessor); } delete list[1]; return list; })(); }
function stores() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); store(list, 1, 5); store(list, 0, 4); return text(list); }
function readsHole() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); let all = ""; for (let i = 0; i < 3; i++) all += String(read(list, i)) + ","; return all; }
function asks() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); return [has(list, 0), has(list, 1), has(list, 3), Object.keys(list).join("/"), Object.hasOwn(list, 1), list.hasOwnProperty(1), JSON.stringify(Object.getOwnPropertyNames(list))].join(" "); }
function pushes() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); const n = list.push("pushed"); return n + " " + text(list); }
function fillsIt() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); list.fill(7); return text(list); }
function loops() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); for (let i = 0; i < 3; i++) list[i] = 2; return text(list); }
function spreads() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); return text([...list]) + " " + text(Array.from(list)) + " " + text(list.concat(["c"])) + " " + text(list.slice()) + " " + text(list.map((x) => x)); }
function applies() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); return String.prototype.concat.apply("", list) + " " + Math.max.apply(null, list) + " " + ((a, b, c) => String(a) + String(b) + String(c))(...list); }
function joins() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); return list.join("-") + " " + list.indexOf("from above") + " " + list.includes("from above") + " " + list.lastIndexOf("from above") + " " + String(list.at(1)) + " " + String(list.find((x) => x !== undefined)); }
function iterates() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); let all = ""; for (const x of list) all += String(x) + ","; list.forEach((x, i) => { all += i + ":" + String(x) + ","; }); for (const k in list) all += k + ";"; return all; }
function sortsAndReverses() { for (let spin = 0; spin < 2; spin++) warm++; const a = make(); a.reverse(); const b = make(); b.sort(); const c = make(); c.unshift("u"); const d = make(); d.splice(0, 1); return text(a) + " " + text(b) + " " + text(c) + " " + text(d); }
function lengths() { for (let spin = 0; spin < 2; spin++) warm++; const list = make(); list.length = 5; store(list, 3, "at three"); const popped = list.pop(); list.length = 2; return String(popped) + " " + text(list); }
const all = [stores, readsHole, asks, pushes, fillsIt, loops, spreads, applies, joins, iterates, sortsAndReverses, lengths];
for (const deed of all) {
  let said = "";
  let counted = "";
  for (let round = 0; round < 300; round++) { try { said = deed(); } catch (error) { said = error.constructor.name + ": " + error.message; } counted = tally(); }
  console.log(deed.name, said, "//", counted);
}
