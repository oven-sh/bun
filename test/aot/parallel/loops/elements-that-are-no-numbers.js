// Inner loops of a few iterations that compare an element which is expected to be a number and is an object, a text, null, a bigint, a symbol: every relation and equality, both sides, beside numbers and arithmetic; the bound of a later loop is the key.
const say = value => typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value);
function lessDo(list, count) { let i = 0; do { for (let j = 0; j < 3; j++) { if (list[count] < 2) break; } } while (++i < 3); for (let k = 0; k < count; k++) { } return i; }
function greaterDo(list, count) { let i = 0; do { for (let j = 2; j >= 0; j--) { if (list[count] > 2) break; } } while (++i < 3); for (let k = 0; k < count; k++) { } return i; }
function lessEqualFor(list, count) { let s = 0; for (let i = 0; i < 3; i++) { let j = 3; while (--j >= 0) { if (2 <= list[count]) break; s++; } } for (let k = 0; k < count; k++) { } return s; }
function greaterEqualFor(list, count) { let s = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 4; j++) { if (list[count] >= j) continue; s++; } } for (let k = 0; k < count; k++) { } return s; }
function strictly(list, count) { let s = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 2; j++) { if (list[count] === j) s++; if (j !== list[count]) s += 10; } } for (let k = 0; k < count; k++) { } return s; }
function loosely(list, count) { let s = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 2; j++) { if (list[count] == j) s++; if (1 != list[count]) s += 10; } } for (let k = 0; k < count; k++) { } return s; }
function bits(list, count) { let s = 0; let i = 0; do { for (let j = 0; j < 3; j++) { if (list[count] & 1) break; s++; } } while (++i < 3); for (let k = 0; k < count; k++) { } return s; }
function shifts(list, count) { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { s += (list[count] >>> 1) + (list[count] | 0) + (list[count] << j); } for (let k = 0; k < count; k++) { } return s; }
function sums(list, count) { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { s += list[count] * 2; s -= list[count]; } for (let k = 0; k < count; k++) { } return s; }
function adds(list, count) { let s = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) s += list[count]; for (let k = 0; k < count; k++) { } return s; }
function halves(list, count) { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { if (list[count] / 2 < 4) s++; if (-list[count] < j) s++; if (list[count] % 3 > 1) s++; } for (let k = 0; k < count; k++) { } return s; }
function both(list, count) { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { if (list[count] < list[count]) break; if (list[count] >= list[count]) s++; } for (let k = 0; k < count; k++) { } return s; }
function truth(list, count) { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { if (list[count]) s++; if (!list[count]) s += 10; } for (let k = 0; k < count; k++) { } return s; }
function outside(list, count) { let s = 0; if (list[count] < 2) s++; if (list[count] >= 2) s += 10; if (list[count] === 1) s += 100; if (list[count] == 1) s += 1000; for (let k = 0; k < count; k++) { } return s; }
const thrower = { valueOf() { throw new RangeError("valueOf"); } };
const lists = [[{ size: undefined }], [{}, {}, {}, {}, {}], ["text"], ["1", "2", "3", "4", "5"], [null], [undefined, null], [1n, 2n, 3n], [Symbol.iterator], [thrower, thrower], [true, false, true], [[1], [2], [3]], [1, 2, 3, 4, 5, 6], [0.5, 1.5, 2.5], [], [, ,], [x => x], [new Date(5), new Date(7)]];
for (const form of [lessDo, greaterDo, lessEqualFor, greaterEqualFor, strictly, loosely, bits, shifts, sums, adds, halves, both, truth, outside]) for (const list of lists) {
  const answers = [];
  for (const count of [0, 1, 4]) { try { answers.push(say(form(list, count))); } catch (e) { answers.push(e.name); } }
  console.log(form.name, lists.indexOf(list), answers.join());
}
