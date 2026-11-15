// A member that a comma, a name or a pattern takes off its object is called without a receiver, in a loop that counts and in one that does not.
const said = run => { try { const x = run(); return typeof x === "object" && x ? JSON.stringify(x) : String(x); } catch (e) { return e.constructor.name; } };
function push(list, n) { for (let j = 0; j < n; j++) (0, list.push)(j); return list; }
function pushed(list, n) { const { push } = list; for (let j = 0; j < n; j++) push(list[j]); return list; }
function pushOptional(list, n) { for (let j = 0; j < n; j++) (0, list.push)?.(j); return list; }
function pushOnto(list, n) { const out = []; for (let j = 0; j < n; j++) { out.push(list[j]); (0, out.push)(j); } return out; }
function pushCalled(list, n) { const out = []; for (let j = 0; j < n; j++) (0, out.push).call(out, list[j]); return out; }
function pushApplied(list, n) { const out = []; for (let j = 0; j < n; j++) (0, out.push).apply(out, [list[j], j]); return out; }
function pushBound(list, n) { const out = [], add = out.push.bind(out); for (let j = 0; j < n; j++) add(list[j]); return out; }
function pop(list) { let t = 0; for (let j = 0; j < list.length; j++) t += (0, list.pop)(); return t; }
function popped(list) { const { pop } = list; let t = 0; while (list.length) t += pop(); return t; }
function codes(text) { let t = 0; for (let j = 0; j < text.length; j++) t += (0, text.charCodeAt)(j); return t; }
function codesOf(text) { const { charCodeAt } = text; let t = 0; for (let j = 0; j < text.length; j++) t += charCodeAt(j); return t; }
function codesCalled(text) { const { charCodeAt } = ""; let t = 0; for (let j = 0; j < text.length; j++) t += charCodeAt.call(text, j); return t; }
function at(text) { let t = ""; for (let j = 0; j < text.length; j++) t += (0, text.charAt)(j); return t; }
function splice(list) { for (let j = 0; j < 2; j++) (0, list.splice)(0, 1); return list; }
function slice(list) { let t = []; for (let j = 0; j < 3; j++) t = (0, list.slice)(j); return t; }
function max(list) { const { max } = Math; let t = 0; for (let j = 0; j < list.length; j++) t = max(t, (0, Math.abs)(list[j])); return t; }
function has(set, n) { let t = 0; for (let j = 0; j < n; j++) if ((0, set.has)(j)) t++; return t; }
function add(set, n) { for (let j = 0; j < n; j++) (0, set.add)(j); return set.size; }
function get(map, n) { const { get } = map; let t = 0; for (let j = 0; j < n; j++) t += get(j); return t; }
function set(map, n) { for (let j = 0; j < n; j++) (0, map.set)(j, j); return map.size; }
function keys(object) { let t = 0; for (let j = 0; j < 3; j++) t += (0, Object.keys)(object).length + (0, Reflect.ownKeys)(object).length; return t; }
for (let turn = 0; turn < 3; turn++) {
  for (const list of [() => [1, 2, 3], () => [], () => [0.5, 1.5], () => ["a"]])
    for (const run of [push, pushed, pushOptional, pushOnto, pushCalled, pushApplied, pushBound, pop, popped, splice, slice, max]) console.log(run.name, said(() => run(list(), 3)), said(() => run(list(), 0)));
  for (const text of ["", "abc", "a\u{1f600}"]) for (const run of [codes, codesOf, codesCalled, at]) console.log(run.name, said(() => run(text)));
  for (const run of [has, add]) console.log(run.name, said(() => run(new Set([1, 2]), 3)), said(() => run(new Set(), 0)));
  for (const run of [get, set]) console.log(run.name, said(() => run(new Map([[1, 2]]), 3)), said(() => run(new Map(), 0)));
  console.log(said(() => keys({ a: 1, b: 2 })));
}
