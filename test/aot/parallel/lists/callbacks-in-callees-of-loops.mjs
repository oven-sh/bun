// A function that loops call calls another that passes callbacks to array methods: they are copied there too. Where numbers arrive, a reduction without a start holds numbers alone.
// STATISTIC: CallbackChainsFused >= 8
const say = v => typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(say).join() + "]" : typeof v === "object" && v ? "o" + v.k : String(v);
function total(list) { const own = []; for (let i = 0; i < list.length; i++) own.push(list[i] * 2); return own.reduce((a, b) => a + b, 0); }
function sum(list) { const own = []; for (let i = 0; i < list.length; i++) own.push(list[i] * 1); return own.reduce((a, b) => a + b); }
function most(list) { const own = []; for (let i = 0; i < list.length; i++) own.push(list[i] | 0); return own.reduce((a, b) => Math.max(a, b)); }
function last(list) { const own = []; for (let i = 0; i < list.length; i++) own.push(list[i] * 0.5); return own.reduce((a, b) => b); }
function doubled(list) { const own = []; for (let i = 0; i < list.length; i++) own.push(list[i] - 1); return own.map(x => x * 2); }
function kept(list) { const own = []; for (let i = 0; i < list.length; i++) own.push(list[i] * 1); return own.filter(x => x > 1); }
function anyOver(list) { const own = []; for (let i = 0; i < list.length; i++) own.push(list[i] * 1); return own.some(x => x > 2) + " " + own.every(x => x > 0) + " " + own.findIndex(x => x === 2); }
function positions(list) { const own = []; for (let i = 0; i < list.length; i++) own.push(list[i] * 1); return own.map((x, i) => x + i); }
const functions = [total, sum, most, last, doubled, kept, anyOver, positions];
function once(list, k) { let said = ""; for (let f = 0; f < functions.length; f++) { try { said += say(functions[f](list)) + " "; } catch (e) { said += e.constructor.name + " "; } } return said; }
function called(list) { return say(total(list)) + " " + say(doubled(list)) + " " + say(kept(list)) + " " + anyOver(list) + " " + say(positions(list)) + " " + (list.length ? say(sum(list)) + " " + say(most(list)) + " " + say(last(list)) : "none"); }
const lists = [[], [-0], [3], [1, 2, 3, 4], [0.5, 1.5, -2.5], [NaN, 1], [1, NaN], [2147483647, 1], [-5, -3, -9], [0, -0], [-0, 0], ["3", 1, "2"], [undefined, 1], [null, 2], [1, , 3], Array.from({ length: 40 }, (_, i) => i - 7.5), [Infinity, -Infinity], [-0, -0, -0]];
for (let turn = 0; turn < 4; turn++) for (let k = 0; k < lists.length; k++) { console.log(k, once(lists[k], k)); console.log(k, called(lists[k])); }
