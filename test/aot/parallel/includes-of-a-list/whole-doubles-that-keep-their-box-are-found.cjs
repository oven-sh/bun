"use strict";
const out = [], hide = v => [v][JSON.parse("0")], at = (l, v) => l.indexOf(v), has = (l, v) => l.includes(v), say = (l, ...vs) => { for (const v of vs) out.push(at(hide(l), hide(v)) + (has(hide(l), hide(v)) ? "y" : "n")); };
const f = new Float64Array([1, 2, -3, 2147483647, -2147483648, 4]), d = JSON.parse("[0.5]"); for (const v of [5, 6, 2147483647, -1]) d.push(v); const whole = [...f]; while (d.length > 1) whole.push(d.pop()); whole.push(Math.sqrt(hide(81)), Number(hide("12")), Date.UTC(1970, 0, 1, 0, 0, 0, 13), performance.timeOrigin > 0 ? 14 : 0); for (const extra of ["t", null, 1n]) { const l = [extra, ...whole]; say(l, 1, 2, -3, 2147483647, -2147483648, 4, 5, 6, -1, 9, 12, 13, 14, 0, 99); say(l.slice().reverse(), 1, 9, 12); }
console.log(out.length, out.join());
