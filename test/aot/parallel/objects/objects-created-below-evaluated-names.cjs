// Text that the program evaluates sees the literal under the name that objects are created below.
const proto = { m() { return 1; } };
const other = { twice() { return this.v * 2; } };
const out = [];
const name = process.argv.length > 60 ? "other" : "proto";
function inner(text) {
  return eval(text);
}
out.push(typeof eval("proto"), typeof inner(name), inner(`Object.keys(${name}).join()`), eval("proto.m") === Object.create(proto).m);
const made = Object.create(other);
made.v = 4;
out.push(made.twice(), inner("other") === Object.getPrototypeOf(made), Object.create(proto).m());
console.log(out.join("\n"));
