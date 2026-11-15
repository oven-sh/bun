// Loops that store in each turn and calculate with a value that none of their turns changes. Its kind differs from call to call, between the loops and behind an alias.
const log = [];
const word = x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : typeof x === "object" && x !== null ? "object" : typeof x === "symbol" ? "symbol" : String(x);
function say(...words) { log.push(words.map(word).join(" ")); }
class Holder { constructor(row, width) { this.row = row; this.width = width; } set(i, value) { this.row[i & 3] = value; return this; } get(i) { return this.row[i & 3]; } }
function mix(Base) { if (Base === undefined) Base = Object; return class Mixed extends Base { first() { return this.get(0); } }; }
class Below extends mix() { constructor(row, width) { super(); this.row = row; this.width = width; } set(i, value) { this.row[i & 3] = value; return this; } get(i) { return this.row[i & 3]; } }
function sums(object, n) { let sum = 0; for (let i = 0; i < n; i++) { object.set(i, i & 7); sum = (sum + object.get(i + 1) + object.width) | 0; } return sum; }
function doubles(object, n) { let sum = 0; for (let i = 0; i < n; i++) { object.set(i, i * 0.5); sum += object.get(i) * object.width; } return sum; }
function texts(object, n) { let sum = ""; for (let i = 0; i < n; i++) { object.set(i, i); sum += object.width + object.get(i); } return sum; }
function bits(object, n, mask) { let sum = 0; for (let i = 0; i < n; i++) { object.row[i & 3] = i; sum ^= (object.row[i & 3] & mask) + (object.width >>> 1); } return sum; }
function some(object, n, at) { let sum = 0; for (let i = 0; i < n; i++) { object.row[i & 3] = i; if (i === at) sum += object.width - 1; else sum++; } return sum; }
function below(object, limit, n) { let turns = 0; for (let i = 0; i < n; i++) { object.row[i & 3] = i; if (i < limit) turns += object.row[i & 3]; } return turns; }
function aliased(object, other, n) { let sum = 0; for (let i = 0; i < n; i++) { object.row[i & 3] = i; other.width = i === 2 ? "two" : i / 2; sum += object.width; } return sum; }
function nested(object, n) { let sum = 0; for (let j = 0; j < n; j++) { const width = object.width; for (let i = 0; i < n; i++) { object.row[i & 3] = i + j; sum += object.row[(i + 1) & 3] - width; } if (j === 1) object.width = j + 0.25; } return sum; }
function stored(object, list, n) { for (let i = 0; i < n; i++) { list[i] = i; list[i] = list[i] * object.width; } return list.map(word).join(); }
const widths = [4, -0, 0.5, NaN, 2147483647, -2147483648, 4294967296, 1e300, "7", "w", undefined, null, true, { valueOf() { say("asked"); return 3; } }, [], [5], 12n, Symbol("s"), { valueOf() { throw new RangeError("no"); } }];
function tried(title, run) { try { say(title, run()); } catch (error) { say(title, error.name); } }
for (let turn = 0; turn < 3; turn++) {
  for (const width of widths) {
    for (const make of [w => new Holder([1, 2, 3, 4], w), w => new Below([1, 2, 3, 4], w), w => new Below([0.5, 1, 2, 3], w), w => new Holder(["x", 1, 2, 3], w)]) {
      const object = make(width);
      tried("sums", () => sums(object, 9)); tried("sums", () => sums(object, 0));
      tried("doubles", () => doubles(object, 6)); tried("texts", () => texts(object, 3));
      tried("bits", () => bits(object, 9, width)); tried("some", () => some(object, 9, 5)); tried("some", () => some(object, 9, 20));
      tried("below", () => below(object, width, 7)); tried("aliased", () => aliased(object, object, 5)); object.width = width;
      tried("aliased", () => aliased(object, make(width), 5)); tried("nested", () => nested(object, 4)); object.width = width;
      tried("stored", () => stored(object, [], 5)); tried("stored", () => stored(object, [0.5, 1, 2], 5));
      say(object.row.map(word).join(), object.width);
    }
  }
}
console.log(log.join("\n"));
