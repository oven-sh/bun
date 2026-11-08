import * as ns from "./lib";
const late = await import("./lib"); if (late.check !== ns.check) throw new Error("two objects");
const name = process.env.NAME || "check";
function show(x: unknown): string { return typeof x + ":" + String(x); }
let said = "";
let sum = 0; for (let i = 0; i < 5; i++) sum += ns.check(i); said += show(sum);
(0, eval)("(n) => { n.box.value = 's'; }")(ns);
ns.bump();
sum = 0; for (let i = 0; i < 5; i++) sum += ns.check(i);
console.log(said, "|", show(sum), ns.state, ns.readBox());
