// A spread call passes a Buffer beside strings and numbers: a loop that takes it for bytes asks the class that made it.
function sum(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
function sumBackward(tag, x) { let s = 0; for (let i = x.length - 1; i >= 0; i--) s = s + x[i]; return s; }
function sumWhile(tag, more, x) { let s = 0, i = 0; while (i < x.length) { s += x[i]; i++; } return s; }
function sumFirst(x, tag) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
function mix(tag, x) { let s = 0; for (let i = 0; i + 1 < x.length; i += 2) s ^= x[i] | x[i + 1] << 8; return s; }
function fill(tag, x) { for (let i = 0; i < x.length; i++) x[i] = i + 1; return x[1]; }
function members(tag, x) { return [x.length, x.byteLength, x.subarray?.(1)?.length, x.map?.(v => v + 1)?.length, x.at?.(0)].join(); }
class Reader {
  constructor(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; this.sum = s; }
  static read(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
  #read(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
  go(...r) { return this.#read(...r); }
}
class Below extends Reader { constructor(...r) { super(...r); } }

const forward = f => function (...r) { return f(...r); };
const twice = f => forward(forward(f));
function forwardArguments() { return sum(...arguments); }
function forwardByApply(...r) { return sum.apply(null, r); }
function forwardByReflect(...r) { return Reflect.apply(sum, undefined, r); }
function forwardLead(tag, ...r) { return sum(tag, ...r); }
const forwardArrow = (...r) => sum(...r);
function forwardDirect(...r) { return sum(...r); }
function forwardWhile(...r) { return sumWhile(...r); }
function forwardFirst(...r) { return sumFirst(...r); }
function forwardMix(...r) { return mix(...r); }
function forwardFill(...r) { return fill(...r); }
function forwardMembers(...r) { return members(...r); }
function forwardBackward(...r) { return sumBackward(...r); }
function forwardStatic(...r) { return Reader.read(...r); }
function forwardNew(...r) { return new Reader(...r).sum; }

const text = String(12);
const buffers = () => [Buffer.from([1, 2, 3]), Buffer.from("abc"), Buffer.from("YWI=", "base64"), Buffer.from(`t${text}`), Buffer.alloc(3), Buffer.concat([Buffer.from("a"), Buffer.from("b")])];
const others = () => [new Uint8Array([4, 5]), [1, 2, 3], "text", 5, new Float64Array([0.5, 1.5]), { length: 2, 0: 5, 1: 6 }];
for (const x of buffers()) {
  console.log(forwardDirect("t", x), forwardArguments(1, x), forwardByApply(null, x), forwardByReflect("t", x), forwardLead(2, x), forwardArrow("t", x));
  console.log(forwardWhile("t", 1, x), forwardFirst(x, "t"), forwardMix("t", x), forwardMembers("t", x), forwardBackward("t", x), forwardStatic("t", x), forwardNew("t", x));
  console.log(new Below("t", x).sum, new Reader(1, x).go("t", x), twice(sum)("t", x), sum(...["t", x]));
  console.log(forwardFill("t", x), [...x].join());
}
for (const x of others()) console.log(sum("t", x), forward(sum)("t", x), sumFirst(x, "t"), new Reader(1, [1]).go("t", x));
