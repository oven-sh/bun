// A window of words is copied out of a longer list, read for its bits, and asked whether each is there: what is absent in the list is undefined in the window.
const held = JSON.parse("{}"), name = text => text + process.argv.length % 1;
held[name("window")] = function window(list, from, count) { const words = []; let bits = 0, missing = 0; for (let k = 0; k < count; k++) { words[k] = list[from + k]; if (words[k] === undefined) missing++; bits = (bits << 1) ^ words[k]; } return bits + "," + missing + "," + words.length; };
held[name("after")] = function after(list, from, count) { const words = []; let bits = 0; for (let k = 0; k < count; k++) { words[k] = list[from + k]; bits |= words[k]; } let there = ""; for (let k = 0; k < count; k++) there += words[k] === undefined ? "-" : k in words ? "+" : "?"; return bits + "," + there; };
held[name("kept")] = function kept(list, count) { const words = []; let bits = 1; for (let k = 0; k < count; k++) { words[k] = list[k]; bits = bits + (words[k] & 255) | 0; } return [bits, words]; };
held[name("typed")] = function typed(list, count) { const words = []; let bits = 0, numbers = 0; for (let k = 0; k < count; k++) { words[k] = list[2 * k]; bits ^= words[k] >>> 1; if (typeof words[k] === "number") numbers++; } return bits + "," + numbers; };
const base = count => Array.from({ length: count }, (_, k) => Math.imul(k + 11, 0x85ebca6b));
const makers = {
  whole: () => base(20), hole: () => { const list = base(20); delete list[4]; delete list[6]; return list; }, undefinedInside: () => Object.assign(base(20), { 4: undefined }), short: () => base(5), none: () => [], doubles: () => base(20).map(value => value + 0.5), holeOfDoubles: () => { const list = base(20).map(value => value + 0.5); delete list[4]; return list; }, nan: () => Object.assign(base(20), { 4: NaN }), nulls: () => Object.assign(base(20), { 4: null }), texts: () => Object.assign(base(20), { 4: "", 5: "9" }),
  view: () => Uint32Array.from(base(20)), word: () => "271828", alike: () => ({ length: 6, 0: 1, 2: 3, 4: 5 }), above: () => { const list = base(20); delete list[4]; Object.setPrototypeOf(list, { __proto__: Array.prototype, 4: 99 }); return list; }, getter: () => { const list = base(20); let asked = 0; Object.defineProperty(list, 4, { get() { return asked++ % 2 ? undefined : 3; } }); return list; },
};
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const say = value => Object.is(value, -0) ? "-0" : String(value), told = answer => Array.isArray(answer) ? answer[0] + ":" + Array.from(answer[1], (value, k) => (k in answer[1] ? say(value) : "hole")).join() : answer;
const lines = [];
for (let round = 0; round < 3; round++) for (const kind of Object.keys(makers)) {
  const line = [round, kind];
  for (const [from, count] of [[0, 12], [2, 5], [12, 10], [-1, 4], [0, 0]]) line.push(attempt(() => held[name("window")](makers[kind](), from, count)), attempt(() => held[name("after")](makers[kind](), from, count)));
  line.push(attempt(() => told(held[name("kept")](makers[kind](), 8))), attempt(() => held[name("typed")](makers[kind](), 9)));
  lines.push(line.join(" "));
}
console.log(lines.join("\n"));
