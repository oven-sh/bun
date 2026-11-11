"use strict";
const out = [];
const table = {
  less(list) { let s = 0; for (let i = 0; i < list.length; i++) s -= list[i]; return s; },
  plus(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; },
  largest(list) { let m = -Infinity; for (let i = 0; i < list.length; i++) if (list[i] > m) m = list[i]; return m; },
  bits(list) { let s = 0; for (let i = 0; i < list.length; i++) s ^= list[i]; return s; },
  shrinks(list) { let s = 0; for (let i = 0; i < list.length; i++) { s -= list[i]; if (i === 1) list.length = 2; } return s; },
  grows(list) { let s = 0; for (let i = 0; i < list.length && i < 6; i++) { s -= list[i]; if (i === 1) list.push(0.5); } return s; },
  turnsText(list) { let s = 0; for (let i = 0; i < list.length; i++) { s -= list[i]; if (i === 0) list[2] = "7"; } return s; },
  loses(list) { let s = 0; for (let i = 0; i < list.length; i++) { s -= list[i]; if (i === 0) delete list[2]; } return s; },
  pastTheEnd(list) { let s = 0; for (let i = 0; i <= list.length; i++) s -= list[i]; return s; },
  downwards(list) { let s = 0; for (let i = list.length - 1; i >= 0; i--) s = s * 2 - list[i]; return s; },
};
class Below extends Array { get 1() { return 40; } }
const makers = [
  () => [1, 2, 3, 4], () => [1.5, 2.5, -0, 4], () => [], () => [7], () => [1, "2", 3, 4], () => [1, , 3, 4], () => [1.5, , 3.5, 4], () => [NaN, Infinity, -Infinity, 1],
  () => [2147483647, 2147483647, -2147483648, 1], () => [1, { valueOf() { return 5; } }, 3, 4], () => [1, null, undefined, true], () => Object.freeze([1, 2, 3, 4]),
  () => Below.from([1, 2, 3, 4]), () => new Float64Array([1.5, 2, 3, 4]), () => new Uint8Array([1, 2, 3, 4]), () => "1234", () => ({ length: 3, 0: 1, 1: 2, 2: 3 }),
  () => (function () { return arguments; })(1, 2, 3, 4), () => new Proxy([1, 2, 3, 4], {}), () => [1n, 2n], () => Array.from({ length: 70 }, (_, i) => i * 0.5),
];
const names = JSON.parse(JSON.stringify(Object.keys(table)));
function tell(v) { return typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)); }
for (let round = 0; round < 3; round++) for (const name of names) { const said = []; for (const make of makers) { try { said.push(tell(table[name](make()))); } catch (e) { said.push(e.name); } } if (round === 2) out.push(name + ": " + said.join(" | ")); }
console.log(out.join("\n"));
