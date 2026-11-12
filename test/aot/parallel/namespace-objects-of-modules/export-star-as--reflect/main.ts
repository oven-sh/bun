import { ns } from "./barrel";
const name = process.env.NAME || "check";
function show(x: unknown): string { return typeof x + ":" + String(x); }
let said = "";
let sum = 0; for (let i = 0; i < 5; i++) sum += ns.check(i); said += show(sum);
said += ' ' + show((Reflect.get(ns, 'check') as any)('r'));
ns.bump();
sum = 0; for (let i = 0; i < 5; i++) sum += ns.check(i);
console.log(said, "|", show(sum), ns.state, ns.readBox());
