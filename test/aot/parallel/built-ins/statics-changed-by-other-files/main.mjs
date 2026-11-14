import { replaceDates } from "./changes.mjs";

class Bytes extends BigInt64Array {}
console.log(new Bytes(2).length);
const read = text => String(Temporal.PlainDate.from(text));
console.log(read("2026-11-13"), String(Temporal.PlainTime.from("12:30")));
replaceDates(text => "replaced " + text);
console.log(read("2026-11-13"), String(Temporal.PlainTime.from("12:30")));
