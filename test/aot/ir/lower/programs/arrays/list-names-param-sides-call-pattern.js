// RUN: lower
// OPTIONS: builtin-modules

// A list names a parameter on both sides of a call that stores an int32 to it and a pattern takes it apart.
const f = (n) => { const [x, y, z] = [n, (() => n >>= 1)(), n]; console.log(x, y, z); };
f(5.5);

// CHECK-LABEL: function {{*}}name="f"
