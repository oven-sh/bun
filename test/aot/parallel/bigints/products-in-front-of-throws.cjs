// A product stands in front of a throw, a return and a call that stand between it and its remainder.
const say = f => { try { return String(f()); } catch (error) { return error.name + " " + error.message.slice(0, 12); } };
function orThrow(x, y, m) { const a = x - 0n, b = y - 0n, product = a * b; if (m === undefined) throw new RangeError("no divisor"); return product % m >= 0n; }
function ofUnknown(x, y, m) { const a = -x, b = -y, product = a * b; if (m === undefined) throw new RangeError("no divisor"); return product % m >= 0n; }
function inLoop(x, y, m, n) { let count = 0; for (let i = 0; i < n; i++) { const a = -x, b = -y, product = a * b; if (i === m) throw new RangeError("no divisor"); if (product % m >= 0n) count++; } return count; }
function orReturn(x, y, m) { const a = -x, b = -y, product = a * b; if (m === undefined) return "none"; return product % m >= 0n; }
for (const [x, y] of [[1n, 2n], [1n, 2], [3, 4n], [5, 6], ["7", 8n], [undefined, 1n]])
  for (const m of [7n, undefined, 0n, 2])
    console.log(say(() => orThrow(x, y, m)), "|", say(() => ofUnknown(x, y, m)), "|", say(() => inLoop(x, y, m, 3)), "|", say(() => orReturn(x, y, m)));
