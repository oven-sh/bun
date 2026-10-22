// What built ins make: programs p freeze closures. It prints what plain Bun prints.
// @ts-nocheck
// Instructions a freeze of a closure: run with "freeze" and with "none", the difference divided by the count.
const freezes = process.argv[2] === "freeze";
const count = 200000;
let kept = 0;
for (let i = 0; i < count; i++) {
  const f = function (x) { return x + i; };
  f.index = i;
  f.label = "l";
  if (freezes) Object.freeze(f);
  kept += f.index & 1;
}
console.log(kept);
