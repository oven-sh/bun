function id(x) { return x; }
function read(v) { return (v.a === undefined ? "-" : v.a) + "|" + (v.b === undefined ? "-" : v.b) + "|" + typeof v.c; }
console.log(read(id({ a: 1 })), read(id({ b: 2 })), read(id({ c() { return 1; } })), read(id({ a: "x", b: "y", c: 0 })));
