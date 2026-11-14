// STATISTIC: RemainderTruthsInLine >= 1
// A loop asks for the truth of `n % x` of operands nobody knows. Integers are divided in line, everything else by the stub.
let asked = "";
const objects = [{ valueOf() { asked += "v"; return 6; } }, { toString() { asked += "s"; return "4"; } }, { [Symbol.toPrimitive](hint) { asked += hint[0]; return 9; } }, { valueOf() { asked += "t"; throw new RangeError("thrown"); } }];
const lists = [[1, 2, 3, 4, 5, 6, 10, 12, 60, 61], [0, -0, 1, -1, -2, -60, 7], [2147483647, -2147483648, 2147483648, 4294967295, 1e300], [0.5, 1.5, NaN, Infinity, -Infinity], ["6", "x", "", true, false, null, undefined], [3n, 60n, 0n, 5], [[], [4], ...objects, Symbol.iterator]];
const dividends = [60, 0, -0, 1, -60, 2147483647, -2147483648, 0.5, NaN, "60", null, undefined, true, 60n, objects[0], objects[3]];
function* pass(data) { for (const v of data) yield v; }
function* filter(fn, data) { let i = 0; for (const v of data) { if (!fn(v, i++)) continue; yield v; } }
function count(fn, data) { let c = 0, i = 0; for (const v of data) if (fn(v, i++)) c++; return c; }
function each(n) { return [x => !(n % x), x => n % x, x => !(x % n), (x, i) => i % x ? 1 : 0]; }
function straight(n, data) { let out = ""; for (const x of data) { if (n % x) out += "T"; else out += "F"; } return out; }
function rest(n, data) { let c = 0; for (const x of data) { try { if (!(x % n)) continue; c++; } catch (e) { c += 100; } finally { asked += "."; } } return c; }
function attempt(f) { try { return f(); } catch (e) { return e.name[0] + e.message.length; } }
for (const n of dividends) {
  const line = [];
  for (const list of lists) {
    for (const fn of each(n)) line.push(attempt(() => count(fn, list)), attempt(() => count(fn, pass(list))), attempt(() => [...filter(fn, pass(list))].length));
    line.push(attempt(() => straight(n, list)), attempt(() => rest(n, list)));
  }
  let sum = 0;
  for (const c of line.join() + asked) sum = (sum * 31 + c.charCodeAt(0)) | 0;
  console.log(String(typeof n), sum, line.join().slice(0, 120), asked.length);
}
const factors = n => [...filter(x => !(n % x), pass(Array.from({ length: n }, (_, i) => i + 1)))];
console.log(factors(60).join(), factors(97).join(), factors(360).length);
