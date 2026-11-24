interface T {
  n: number;
  x?: number | undefined;
  y?: number | undefined;
  z?: string | undefined;
}
function say(v: any): string {
  return v === null
    ? "null"
    : typeof v === "object"
      ? "object " + Object.prototype.toString.call(v)
      : typeof v + " " + String(v);
}
function descriptor(o: any): string {
  const d = Object.getOwnPropertyDescriptor(o, "x");
  return d
    ? Object.keys(d)
        .map(k => k + ":" + typeof (d as any)[k])
        .join(",")
    : "none";
}
function read(o: any): any {
  return o.x;
}
function tell(o: any): string {
  let spread = "";
  for (const k in { ...o }) spread += k;
  return (
    say(read(o)) +
    " " +
    ("x" in o) +
    " " +
    Object.hasOwn(o, "x") +
    " [" +
    descriptor(o) +
    "] " +
    Object.keys(o).join() +
    " " +
    JSON.stringify(o) +
    " " +
    spread
  );
}
function sum(list: T[]): string {
  let all = 0,
    missing = 0;
  for (let i = 0; i < 6000; i++) {
    const v = list[i % list.length]!.x;
    if (v === undefined) missing++;
    else all += v;
  }
  return all + " " + missing;
}
function make(n: number): T {
  return { n };
}
function given(n: number): T {
  const o = make(n);
  o.x = undefined;
  return o;
}
function literal(n: number): T {
  return {
    n,
    get x() {
      return n + 1;
    },
    z: "z",
  };
}
function left(n: number): T {
  return { n, y: n };
}
function Above(this: any) {}
(Above.prototype as any)[["x"][0]!] = 500;
const list: T[] = [];
for (let i = 0; i < 60; i++) list.push(i % 3 === 0 ? given(i) : i % 3 === 1 ? literal(i) : left(i));
console.log(sum(list));
for (const o of list.slice(0, 3)) console.log(tell(o));
for (const o of list) Object.setPrototypeOf(o, Above.prototype);
console.log(sum(list));
for (const o of list.slice(0, 3)) console.log(tell(o));
(Above.prototype as any)[["x"][0]!] = "text";
for (const o of list.slice(0, 3)) console.log(tell(o));
