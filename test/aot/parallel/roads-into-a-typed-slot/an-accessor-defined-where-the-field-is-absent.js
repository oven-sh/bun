// the makers of the layout lay the accessor on some objects only, behind the allocation, each with a function of its own
function first() { return "first" + this.raw; }
function second() { return "second" + this.raw; }
function make(k) {
  const o = { raw: k };
  if (k & 1) Object.defineProperty(o, "value", { get: first, configurable: true, enumerable: true });
  else if (k & 2) Object.defineProperty(o, "value", { get: second, configurable: true, enumerable: true });
  return o;
}
function read(o) { return o.value; }
const out = []; for (let round = 0; round < 3; round++) for (let k = 0; k < 8; k++) out.push(String(read(make(k))));
console.log(out.join(" "));
