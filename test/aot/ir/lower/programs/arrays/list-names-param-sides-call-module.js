// RUN: lower
// OPTIONS: builtin-modules

// A list names a parameter on both sides of a call that stores an int32 to it and is kept in a variable of the module.
let kept;
const f = (n) => { kept = [n, ({ m() { return n <<= 1; } }).m(), n]; };
f(2.5);
for (const e of kept) console.log(e);
console.log(kept.map((e) => e * 2).join());

// CHECK-LABEL: function {{*}}name="f"
// CHECK-LABEL: function {{*}}name="m"
