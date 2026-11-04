// in a loop a bit operator takes what a call gives, of which an integer is expected: the call gives int32s, then fractions and large numbers, then a text, a BigInt, and an object that converts
let conversions = "";
const outside: any[] = JSON.parse('[3, 3.75, -0, 4294967299, -4294967299.5, 1e300, "12", "x", null, true]');
outside.push(NaN, undefined, BigInt(3), { valueOf() { conversions += "v"; return 9; } }, { valueOf() { throw new RangeError("no number"); } });
function fold(make: (i: number) => any) { let log = ""; for (let i = 0; i < 4; i++) log += ((make(i) as number) & (i + 13)) + ","; return log; }
function deed(make: (i: number) => any) { try { return fold(make); } catch (e) { return (e as Error).name; } }
console.log(deed(i => i * 5), deed(i => i - 2));
let log = "";
for (let turn = 0; turn < 100; turn++) log = deed(i => i + turn);
console.log(log);
for (let k = 0; k < outside.length; k++) console.log(k, deed(() => outside[k]));
console.log(conversions, deed(i => i * 5));
