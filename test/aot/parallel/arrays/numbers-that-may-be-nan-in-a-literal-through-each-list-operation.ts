// A list literal of numbers that may be NaN, made where the list need not be built, handed to each operation on a list. The test of its storage is answered while the list is not there, and
// says nothing of it once it is built: a NaN gives it storage for any value. An operation that relied on that test by its place alone wrote nothing: JSON.stringify([n]) was an empty text.
function f0(n: number, m: number, x: number) {
  const l = [n];
  return JSON.stringify(l);
}
function f1(n: number, m: number, x: number) {
  const l = [n];
  return JSON.stringify([l]);
}
function f2(n: number, m: number, x: number) {
  const l = [n];
  return JSON.stringify({ l });
}
function f3(n: number, m: number, x: number) {
  const l = [n];
  return JSON.stringify(l, null, 1);
}
function f4(n: number, m: number, x: number) {
  const l = [n];
  return l.includes(x);
}
function f5(n: number, m: number, x: number) {
  const l = [n];
  return l.includes(NaN);
}
function f6(n: number, m: number, x: number) {
  const l = [n];
  return l.indexOf(x);
}
function f7(n: number, m: number, x: number) {
  const l = [n];
  return l.lastIndexOf(x);
}
function f8(n: number, m: number, x: number) {
  const l = [n];
  return l.join();
}
function f9(n: number, m: number, x: number) {
  const l = [n];
  return l.join("-");
}
function f10(n: number, m: number, x: number) {
  const l = [n];
  return String(l);
}
function f11(n: number, m: number, x: number) {
  const l = [n];
  return `${l}`;
}
function f12(n: number, m: number, x: number) {
  const l = [n];
  return String(l.slice(0));
}
function f13(n: number, m: number, x: number) {
  const l = [n];
  return String(l.slice(1));
}
function f14(n: number, m: number, x: number) {
  const l = [n];
  return String(l.concat(x));
}
function f15(n: number, m: number, x: number) {
  const l = [n];
  return String(l.concat(l));
}
function f16(n: number, m: number, x: number) {
  const l = [n];
  return String([...l]);
}
function f17(n: number, m: number, x: number) {
  const l = [n];
  return String([x, ...l]);
}
function f18(n: number, m: number, x: number) {
  const l = [n];
  return Math.max(...l);
}
function f19(n: number, m: number, x: number) {
  const l = [n];
  return Math.min.apply(null, l);
}
function f20(n: number, m: number, x: number) {
  const l = [n];
  return (() => {
    let s = 0;
    for (const v of l) s += v === v ? v : 1000;
    return s;
  })();
}
function f21(n: number, m: number, x: number) {
  const l = [n];
  return (() => {
    let s = "";
    for (const k in l) s += k;
    return s;
  })();
}
function f22(n: number, m: number, x: number) {
  const l = [n];
  return l[0];
}
function f23(n: number, m: number, x: number) {
  const l = [n];
  return l[0] + 1;
}
function f24(n: number, m: number, x: number) {
  const l = [n];
  return l[5];
}
function f25(n: number, m: number, x: number) {
  const l = [n];
  return l.length;
}
function f26(n: number, m: number, x: number) {
  const l = [n];
  return (() => {
    const [a, b] = l;
    return String(a) + String(b);
  })();
}
function f27(n: number, m: number, x: number) {
  const l = [n];
  return String(l.map(v => v * 2));
}
function f28(n: number, m: number, x: number) {
  const l = [n];
  return String(l.filter(v => v === v));
}
function f29(n: number, m: number, x: number) {
  const l = [n];
  return l.reduce((a, v) => a + v, 0);
}
function f30(n: number, m: number, x: number) {
  const l = [n];
  return l.some(v => v !== v);
}
function f31(n: number, m: number, x: number) {
  const l = [n];
  return l.every(v => v === v);
}
function f32(n: number, m: number, x: number) {
  const l = [n];
  return l.find(v => v !== v);
}
function f33(n: number, m: number, x: number) {
  const l = [n];
  return l.findIndex(v => v !== v);
}
function f34(n: number, m: number, x: number) {
  const l = [n];
  return l.findLast(v => v === v);
}
function f35(n: number, m: number, x: number) {
  const l = [n];
  return (() => {
    let s = 0;
    l.forEach(v => {
      s += v === v ? 1 : 2;
    });
    return s;
  })();
}
function f36(n: number, m: number, x: number) {
  const l = [n];
  return l.at(-1);
}
function f37(n: number, m: number, x: number) {
  const l = [n];
  return String(l.flat());
}
function f38(n: number, m: number, x: number) {
  const l = [n];
  return String(l.flatMap(v => [v]));
}
function f39(n: number, m: number, x: number) {
  const l = [n];
  return String(l.slice().sort());
}
function f40(n: number, m: number, x: number) {
  const l = [n];
  return String(l.slice().sort((a, b) => a - b));
}
function f41(n: number, m: number, x: number) {
  const l = [n];
  return String(l.slice().reverse());
}
function f42(n: number, m: number, x: number) {
  const l = [n];
  return String(l.toSorted());
}
function f43(n: number, m: number, x: number) {
  const l = [n];
  return String(l.toReversed());
}
function f44(n: number, m: number, x: number) {
  const l = [n];
  return String(l.with(0, 1));
}
function f45(n: number, m: number, x: number) {
  const l = [n];
  return String(l.toSpliced(0, 1));
}
function f46(n: number, m: number, x: number) {
  const l = [n];
  return String(l.slice().fill(x));
}
function f47(n: number, m: number, x: number) {
  const l = [n];
  return String([...l.keys()]);
}
function f48(n: number, m: number, x: number) {
  const l = [n];
  return String([...l.entries()]);
}
function f49(n: number, m: number, x: number) {
  const l = [n];
  return String([...l.values()]);
}
function f50(n: number, m: number, x: number) {
  const l = [n];
  return (l.push(x), String(l));
}
function f51(n: number, m: number, x: number) {
  const l = [n];
  return String(l.pop());
}
function f52(n: number, m: number, x: number) {
  const l = [n];
  return String(l.shift());
}
function f53(n: number, m: number, x: number) {
  const l = [n];
  return (l.unshift(x), String(l));
}
function f54(n: number, m: number, x: number) {
  const l = [n];
  return String(l.splice(0, 1));
}
function f55(n: number, m: number, x: number) {
  const l = [n];
  return ((l[0] = x), String(l));
}
function f56(n: number, m: number, x: number) {
  const l = [n];
  return (((l as any)[0] = "s"), String(l));
}
function f57(n: number, m: number, x: number) {
  const l = [n];
  return ((l[3] = x), String(l));
}
function f58(n: number, m: number, x: number) {
  const l = [n];
  return String(Array.from(l));
}
function f59(n: number, m: number, x: number) {
  const l = [n];
  return String(Array.of(...l));
}
function f60(n: number, m: number, x: number) {
  const l = [n];
  return String(new Float64Array(l));
}
function f61(n: number, m: number, x: number) {
  const l = [n];
  return String(new Int32Array(l));
}
function f62(n: number, m: number, x: number) {
  const l = [n];
  return new Set(l).size;
}
function f63(n: number, m: number, x: number) {
  const l = [n];
  return new Map(l.map(v => [v, v])).size;
}
function f64(n: number, m: number, x: number) {
  const l = [n];
  return Array.isArray(l);
}
function f65(n: number, m: number, x: number) {
  const l = [n];
  return Object.keys(l).length;
}
function f66(n: number, m: number, x: number) {
  const l = [n];
  return String(Object.values(l));
}
function f67(n: number, m: number, x: number) {
  const l = [n];
  return String(Object.assign([], l));
}
function f68(n: number, m: number, x: number) {
  const l = [n];
  return String(structuredClone(l));
}
function f69(n: number, m: number, x: number) {
  const l = [n];
  return Bun.inspect(l);
}
function f70(n: number, m: number, x: number) {
  const l = [n];
  return Bun.deepEquals(l, [x, x]);
}
function f71(n: number, m: number, x: number) {
  const l = [n];
  return String(Buffer.from(l));
}
function f72(n: number, m: number, x: number) {
  const l = [n];
  return Math.hypot(...l);
}
function f73(n: number, m: number, x: number) {
  const l = [n];
  return ((...a) => a.length + String(a))(...l);
}
const vals: number[] = [1, 2, NaN, Infinity, -Infinity, -0, 0.5, 2147483648, NaN, 3];
function say(name: string, f: any, n: number, m: number, x: number) {
  let r: any;
  try {
    r = f(n, m, x);
  } catch (e: any) {
    r = "throws " + e.name;
  }
  console.log(name, Object.is(n, -0) ? "-0" : n, m, typeof r === "number" && Object.is(r, -0) ? "-0" : r);
}
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("json", f0, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("json-nested", f1, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("json-field", f2, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("json-fn", f3, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("includes", f4, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("includes-nan", f5, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("indexOf", f6, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("lastIndexOf", f7, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("join", f8, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("join-sep", f9, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("toString", f10, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("tmpl", f11, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("slice", f12, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("slice1", f13, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("concat", f14, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("concat2", f15, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("spread", f16, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("spread2", f17, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("spread-call", f18, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("apply", f19, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("forof", f20, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("forin", f21, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("index", f22, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("index-sum", f23, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("index-out", f24, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("len", f25, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("destr", f26, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("map", f27, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("filter", f28, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("reduce", f29, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("some", f30, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("every", f31, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("find", f32, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("findIndex", f33, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("findLast", f34, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("forEach", f35, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("at", f36, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("flat", f37, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("flatMap", f38, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("sort", f39, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("sort-fn", f40, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("reverse", f41, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("toSorted", f42, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("toReversed", f43, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("with", f44, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("toSpliced", f45, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("fill", f46, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("keys", f47, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("entries", f48, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("values", f49, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("push", f50, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("pop", f51, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("shift", f52, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("unshift", f53, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("splice", f54, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("store", f55, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("store-str", f56, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("store-far", f57, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("from", f58, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("of", f59, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("float64", f60, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("int32", f61, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("set", f62, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("map-ctor", f63, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("isArray", f64, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("keys-obj", f65, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("values-obj", f66, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("assign", f67, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("structured", f68, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("inspect", f69, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("deepEq", f70, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("text", f71, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("hypot", f72, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
for (let t = 0; t < 3; t++)
  for (let v = 0; v < vals.length; v++)
    say("arguments", f73, vals[v], vals[(v + 1) % vals.length], vals[(v + 3) % vals.length]);
