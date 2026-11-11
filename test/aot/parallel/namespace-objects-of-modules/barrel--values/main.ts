import * as ns from "./barrel";
const name = process.env.NAME || "check";
function show(x: unknown): string { return typeof x + ":" + String(x); }
let said = "";
let sum = 0; for (let i = 0; i < 5; i++) sum += ns.check(i); said += show(sum);
for (const value of Object.values(ns)) if (typeof value === 'function' && (value as any).name === name) said += ' ' + show((value as any)('v'));
ns.bump();
sum = 0; for (let i = 0; i < 5; i++) sum += ns.check(i);
console.log(said, "|", show(sum), ns.state, ns.readBox());
