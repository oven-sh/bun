// STATISTIC: LiteralsSharedByLookups >= 10
// A literal that is made once is looked up under a key that is joined of two texts.
const hidden = value => JSON.parse("[0]", (k, v) => k === "0" ? value : v)[0];
const show = v => typeof v === "function" ? "function " + v.name : typeof v === "object" && v ? "{" + Object.keys(v) + "}" : Object.is(v, -0) ? "-0" : String(v);
function behind(k) { return ({ k0x: 1 })[`${k}x`] ?? 0; }
function ahead(k) { return ({ xk0: 1.5, xa: "a" })[`x${k}`]; }
function added(k) { const table = { ax: -0, bx: null, k0x: undefined }; return table[k + "x"]; }
function addedAhead(k) { let table = { xa: true, xb: "b", tok0: 7 }; return table["to" + k]; }
function ofTwo(a, b) { return ({ ab: 1, ba: 2, aa: 3, k0k0: 4 })[`${a}${b}`]; }
function ofThree(a, b) { return ({ "a:b": 1, "b:a": 2 })[`${a}:${b}`]; }
function alone(a) { return ({ a: 1, b: 2, k0: 3 })[`${a}`]; }
function asked(k) { return `${k}x` in { ax: 1, k0x: 2 }; }
function perhaps(k) { return ({ ax: 1, k0x: 2 })?.[`${k}x`]?.toString(); }
function chosen(k) { switch (({ ax: "one", bx: "two" })[k + "x"]) { case "one": return 1; case "two": return 2; default: return 3; } }
function counted(list) { let n = 0; for (let i = 0; i < list.length; i++) n += { ax: 1, bx: 2, "0x": 4 }[`${list[i]}x`] ?? 100; return n; }
function cast(k) { return ({ ax: 1, bx: 2 })[/** @type {"ax" | "bx"} */ (`${k}x`)]; }
function lower(k) { return ({ ax: 1, bx: 2 })[k.toLowerCase() + "x"]; }
class Reader { #suffix = "x"; at(k) { return ({ ax: 1, bx: 2 })[k + this.#suffix]; } static at(k) { return ({ ax: 1, bx: 2 })[`${k}${"x"}`]; } get a() { return ({ ax: 5 })[`${"a"}x`]; } }
function* yielded(list) { for (const k of list) yield ({ ax: 1, bx: 2 })[k + "x"]; }
const arrow = k => ({ ax: 1, bx: 2, __proto__x: 3 })[`${k}x`];
async function awaited(k) { return ({ ax: 1, bx: 2 })[(await k) + "x"]; }
const reader = new Reader(), keys = ["a", "b", "k0", "A", "", "__proto__", "String", "__pro", "constructor", 0, -0, 1.5, null, undefined, true, [], ["a"], [1, 2], { toString: () => "b" }, new URL("file:///a"), 10n, new Date(NaN)];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
for (let turn = 0; turn < 2; turn++)
    for (const key of keys) { const k = hidden(key); console.log([behind, ahead, added, addedAhead, alone, asked, perhaps, chosen, cast, lower, arrow, Reader.at].map(f => show(attempt(() => f(k)))).join(), show(attempt(() => reader.at(k))), show(attempt(() => ofTwo(k, "a"))), show(attempt(() => ofTwo("b", k))), show(attempt(() => ofThree(k, "b")))); }
console.log(reader.a, counted(["a", "b", 0, "c"]), [...yielded(["a", "b", "c"])].join(), behind(process.argv[9]), behind(process.env.NOPE_OF_THIS));
console.log(attempt(() => behind(Symbol())), attempt(() => added(Symbol())), attempt(() => ahead({ toString() { throw new RangeError; } })));
awaited("a").then(show).then(console.log);
