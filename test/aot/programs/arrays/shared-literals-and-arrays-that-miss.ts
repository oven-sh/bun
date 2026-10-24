// Literals of constants share their storage until somebody writes; births in line give up half way where an element does not fit.
import { fullGC, edenGC } from "bun:jsc";
const out: string[] = [];
function constants() { return [1, 2, 3, 4]; }
function words() { return ["a", "b", "c"]; }
function nested(): (number | string)[][] { return [[1, 2], [3, 4], ["x"]]; }
const a = constants(), b = constants(); a.push(5); a[0] = 9; out.push("constants: " + a.join() + " " + b.join() + " " + constants().join());
const c = words(), d = words(); c.length = 1; d.unshift("z"); out.push("words: " + c.join() + " " + d.join() + " " + words().join());
const e = nested(), f = nested(); e[0].push(9); e.push([5]); out.push("nested: " + JSON.stringify(e) + " " + JSON.stringify(f) + " " + JSON.stringify(nested()));
fullGC();
out.push("after a collection: " + a.join() + " " + b.join() + " " + c.join() + " " + d.join() + " " + JSON.stringify(e));
// Numbers that turn out to be no numbers, NaN among doubles, holes among the operands of concat.
function numbers(x: number, y: number, z: number) { return [x, y, z]; }
out.push("doubles: " + numbers(1.5, 2.5, 3.5).join() + " " + numbers(NaN, 1, 2).join() + " " + numbers(1, NaN, 0.5).join() + " " + numbers(-0, 1 / 3, Infinity).map(x => Object.is(x, -0) ? "-0" : String(x)).join());
function joined(x: number[], y: number[], z: number) { return x.concat(y, z); }
const withHole = [1, , 3] as number[]; const doubles = [0.5, 1.5]; const ints = [1, 2];
let bad = "";
for (let i = 0; i < 3000 && !bad; i++) {
  const r1 = joined(ints, ints, i), r2 = joined(doubles, ints, i), r3 = joined(ints, doubles, 0.25), r4 = joined(withHole, ints, i), r5 = joined(ints, withHole, NaN);
  if (r1.join() !== "1,2,1,2," + i || r2.join() !== "0.5,1.5,1,2," + i || r3.join() !== "1,2,0.5,1.5,0.25" || r4.join() !== "1,,3,1,2," + i || (1 in r4) || r5.join() !== "1,2,1,,3,NaN" || (3 in r5)) bad = "round " + i + ": " + [r1, r2, r3, r4, r5].map(x => x.join()).join("|");
  if (i % 700 === 0) { if (i & 1) edenGC(); else fullGC(); }
}
out.push("concat: " + bad);
function mixed(x: unknown[], y: unknown) { return x.concat(y); }
const spreadable = { length: 2, 0: "s0", 1: "s1", [Symbol.isConcatSpreadable]: true };
out.push("concat of other things: " + mixed([1], spreadable).join() + " " + mixed([1], [[2]]).length + " " + mixed([1], "str").join() + " " + mixed([], undefined).length + " " + mixed(["a"], new Proxy([7, 8], {})).join());
const long: number[] = []; for (let i = 0; i < 70; i++) long.push(i); out.push("long concat: " + long.concat(long).length + " " + long.concat(long, long)[209] + " " + long.slice(3, 69).length + " " + long.slice().length + " " + long.slice(-2).join() + " " + long.slice(5, 2).length);
console.log(out.join("\n"));
