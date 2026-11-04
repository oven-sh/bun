// `x * 2`, `10 - x`, `x / 4` with x unknown: an object converts once, by Symbol.toPrimitive before valueOf; a BigInt and a symbol throw; a text, null and a boolean convert
let log = "";
function times(x: any) { return x * 2; }
function minus(x: any) { return 10 - x; }
function over(x: any) { return x / 4; }
const outside: any[] = JSON.parse('[6, -0, 0.5, "8", " ", "x", null, false]');
outside.push(undefined, BigInt(2), Symbol.iterator, { valueOf() { log += "v"; return 12; }, toString() { log += "s"; return "1"; } }, { [Symbol.toPrimitive](hint: string) { log += hint; return 20; }, valueOf() { log += "!"; return 0; } }, { valueOf() { log += "o"; return {}; }, toString() { log += "t"; return "16"; } });
function show(f: (x: any) => number, x: unknown) { try { const y = f(x); return Object.is(y, -0) ? "-0" : String(y); } catch (e) { return (e as Error).name; } }
function deed(x: unknown) { return show(times, x) + " " + show(minus, x) + " " + show(over, x); }
console.log(deed(3), deed(1.5));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed(turn);
console.log(last);
for (let i = 0; i < outside.length; i++) console.log(i, deed(outside[i]), log);
