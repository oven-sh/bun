// functions of every kind, with fewer and more parameters than the call has arguments, are handed in turn to one loop that calls what it was handed
function each(cb: any, n: number) { let s = ""; for (let i = 0; i < n; i++) s += String(cb(i, "x")); return s; }
function deed(cb: unknown) { return each(cb, 2); }
function sloppy(this: unknown) { return typeof this + arguments.length; }
const bound = function (this: unknown, a: unknown, b: unknown, c: unknown) { return String(this) + a + b + c; }.bind("self", "first");
async function later(i: number) { return i; }
function* steps(i: number) { yield i; }
console.log(deed((i: number) => i));
for (let turn = 0; turn < 300; turn++) deed((i: number) => i);
console.log(deed(() => "none"));
console.log(deed((a: unknown, b: unknown, c: unknown, d: unknown) => "" + a + b + c + d));
console.log(deed((...all: unknown[]) => all.length));
console.log(deed(sloppy));
console.log(deed(bound));
console.log(deed(Math.max));
console.log(deed(String));
console.log(deed(later));
console.log(deed(steps));
console.log(deed(new Proxy((i: number) => i * 2, {})));
