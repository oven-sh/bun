interface T {
  n: number;
  x?: number | undefined;
  y?: number | undefined;
  z?: string | undefined;
}
function Above(this: any) {}
(Above.prototype as any)[["x"][0]!] = 500;
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
function fresh(): T[] {
  const list: T[] = [];
  for (let i = 0; i < 60; i++) {
    const o = i % 3 === 0 ? given(i) : i % 3 === 1 ? getter(i) : left(i);
    Object.setPrototypeOf(o, Above.prototype);
    list.push(o);
  }
  return list;
}
function write(o: any, v: any): string {
  try {
    o.x = v;
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function read(o: any): any {
  return o.x;
}
const said: Record<string, number> = {};
for (let turn = 0; turn < 100; turn++) {
  const list = fresh();
  for (let i = 0; i < 60; i++) {
    const how = write(list[i], turn);
    const word =
      (i % 3) +
      " " +
      how +
      " " +
      (read(list[i]) === (i % 3 === 1 ? i + 1 : turn)) +
      " " +
      typeof Object.getOwnPropertyDescriptor(list[i], "x")?.get;
    said[word] = (said[word] ?? 0) + 1;
  }
}
console.log(JSON.stringify(said));
