// STATISTIC: ElementMoveLoops >= 7
// Loops that move elements as their counter goes down, or store one value under many positions: rows, columns, lists in fields, counters that are doubles, bounds that are no integers or no numbers.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 12) }, (_, i) => i in value ? show(value[i]) : "!").join() + "]" + value.length : typeof value === "object" && value ? "o" + Object.keys(value).join() : String(value);
class List {
  constructor(items) { this.items = items; this.size = items.length; }
  insert(at, x) { for (let k = this.size - 1; k > at; k--) this.items[k] = this.items[k - 1]; this.items[at] = x; }
}
const moves = {
  down(b, n) { for (let i = n - 1; i > 0; i--) b[i][1] = b[i - 1][2]; },
  toFirst(b, n) { for (let i = n - 1; i >= 0; i--) b[i][0] = b[0][i]; },
  filled(b, n, x) { for (let i = 0; i < n; i++) b[i][3] = x; },
  filledDown(b, n, x) { for (let i = n - 1; i >= 2; i--) b[i][i] = x; },
  upTo(b, n) { for (let i = 1; i <= n - 1; i++) b[i - 1][2] = b[i][4]; },
  counted(b, n) { for (let i = n; i-- > 1;) b[i][5] = b[i - 1][0]; },
  inserted(b, n, x) { const list = new List(b[2]); list.insert(1, x); list.insert(-1, x); list.insert(2.5, x); return list.items; },
  bounded(b, n, x, bound) { for (let i = 0; i < bound; i++) b[i][1] = b[i][3]; },
};
const n = 6;
const kinds = { real: (i, j) => Math.sin(i * 7 + j * 3 + 1), whole: (i, j) => (i * 5 + j * 3) % 7 - 3, text: (i, j) => "t" + (i + j), object: (i, j) => ({ [i]: j }), mixed: (i, j) => (i + j) % 3 ? i / 2 : "x" + j, missing: (i, j) => (i * j) % 5 === 4 ? undefined : i - j / 2, big: (i, j) => 2 ** 31 + i * j };
const grid = make => { const rows = []; for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) row.push(make(i, j)); rows.push(row); } return rows; };
const changes = { none() { }, hole(b) { delete b[3][2]; delete b[2][0]; }, short(b) { b[2].length = 2; }, shared(b) { b[3] = b[1]; }, self(b) { b[2] = b; }, frozen(b) { Object.freeze(b[4]); }, view(b) { b[3] = new Float64Array(n); }, null(b) { b[5] = null; }, kind(b) { b[3][0] = "other"; }, accessor(b) { Object.defineProperty(b[2], 1, { get() { return 7; }, set(x) { b[0][0] = x; }, configurable: true }); } };
const values = [7, 0.5, -0, NaN, "text", undefined, null, { x: 1 }, 2 ** 40, true, -3];
const bounds = [6, 5.5, 2.25, "4", null, undefined, NaN, -1, true, 1e10, { valueOf: () => 3 }];
for (const move in moves) {
  const out = [];
  for (const kind in kinds) for (const change in changes) {
    const b = grid(kinds[kind]), x = values[out.length % values.length], bound = bounds[out.length % bounds.length];
    changes[change](b);
    let text = "";
    try { text = show(moves[move](b, n, x, bound)); } catch (error) { text = error.constructor.name; }
    try { text += show(b.map(row => row === b ? "self" : row)); } catch (error) { text += error.constructor.name; }
    let sum = 0;
    for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
    out.push((sum >>> 0).toString(36));
  }
  console.log(move, out.join(" "));
}
for (const x of values) { const b = grid(kinds.real), c = grid(kinds.whole), d = grid(kinds.text); for (const rows of [b, c, d]) { moves.filled(rows, n, x); moves.filledDown(rows, n, x); } console.log(show(b[1]), show(c[4]), show(d[5])); }
