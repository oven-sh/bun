// `emit == v` asks emit for a primitive wherever v is one: its own toString() runs, and what it gives may be that very string.
let ran = 0;
function emit() {}
emit.toString = () => {
  ran++;
  return "x";
};
const out = [];
for (const v of ["x", emit, "y", null]) out.push(emit == v, v != emit);
console.log(out.join(" "), ran);
