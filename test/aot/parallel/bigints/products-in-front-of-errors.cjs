// The error of a product comes in front of what stands between it and the remainder: a constant that is not initialized yet, a divisor that a getter or a call gives, an object that is null.
function hourOf(sum, turns = CLOCK.turns) { let left = sum % turns; if (left < 0n) left += turns; return left; }
function line(x, y) { return hourOf(x * y); }
function under(x, y) { const product = x * y; return product % divisor; }
function ofRecord(x, y, record) { const product = x * y; return product % record.turns >= 0n; }
function ofCall(x, y, f) { const product = x * y; return product % f() >= 0n; }
function ofList(x, y, list, index) { const product = x * y; return product % list[index] >= 0n; }
const say = f => { try { return String(f()); } catch (error) { return error.name; } };
const pairs = [[1n, 2], [2, 3n], [3n, 4n], [5, 6], ["7", 8n], [Symbol.iterator, 9n], [undefined, 10n], [{ valueOf() { return 11n; } }, 12n]];
console.log(pairs.map(([x, y]) => say(() => line(x, y))).join(" "));
console.log(pairs.map(([x, y]) => say(() => under(x, y))).join(" "));
const CLOCK = Object.freeze({ first: 4n, turns: (1n << 255n) - 19n });
let divisor = (1n << 255n) - 19n;
for (let turn = 0; turn < 3; turn++) {
  let reads = 0;
  const record = turn === 2 ? null : turn ? { get turns() { reads++; return CLOCK.turns; } } : { turns: CLOCK.turns };
  const list = turn === 2 ? undefined : turn ? new Proxy([], { get() { reads++; return CLOCK.turns; } }) : [CLOCK.turns];
  for (const [x, y] of pairs)
    console.log(say(() => line(x, y)), say(() => under(x, y)), say(() => ofRecord(x, y, record)), say(() => ofCall(x, y, () => { reads++; return CLOCK.turns; })), say(() => ofList(x, y, list, 0)), reads);
  divisor = turn ? "x" : 7n;
}
let sum = 0n;
for (let i = 0n; i < 400n; i++) sum = line(sum + i, sum * sum % CLOCK.turns + (1n << 254n));
console.log(sum.toString(16));
