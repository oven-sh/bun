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
console.log(typeof read(list[1]), read(list[1]), read(list[0]), read(list[2]));
