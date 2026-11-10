interface T {
  n: number;
  x?: number | undefined;
  y?: number | undefined;
  z?: string | undefined;
}
function Above(this: any) {}
(Above.prototype as any)[["x"][0]!] = 500;
function read(o: any): any {
  return o.x;
}
function make(n: number): T {
  return { n };
}
function given(n: number): T {
  const o = make(n);
  o.x = undefined;
  return o;
}
function left(n: number): T {
  return { n, y: n };
}
function getter(n: number): T {
  return {
    n,
    get x() {
      return n + 1;
    },
    z: "z",
  };
}
const list: T[] = [];
for (let i = 0; i < 60; i++) {
  const o = i % 3 === 0 ? given(i) : i % 3 === 1 ? getter(i) : left(i);
  Object.setPrototypeOf(o, Above.prototype);
  list.push(o);
}
const seen = new Map<any, number>();
for (const o of list) {
  const v = read(o);
  seen.set(v, (seen.get(v) ?? 0) + 1);
}
console.log(seen.size, seen.get(500), seen.get(undefined), seen.get(2), seen.get(5));
const kept = list.map(o => read(o));
console.log(kept.length, kept.filter(v => typeof v === "number").length);
console.log(read(list[1]) + 1);
