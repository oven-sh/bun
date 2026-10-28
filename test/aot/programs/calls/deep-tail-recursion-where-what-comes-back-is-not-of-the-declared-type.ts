// Two functions call each other in tail position millions deep. One answers `any`, the other declares a type, and what comes back in the end is parsed out of a text that is made at run time.
// It is of the declared type for some texts and of another for the rest: the stack stays level, and the caller gets the value as it is.
const hops = 2_000_000;
const made = (text: string) => String(Date.now()).slice(99) + text;

function looseNumber(n: number, text: string): any {
  return n === 0 ? JSON.parse(text) : strictNumber(n - 1, text);
}
function strictNumber(n: number, text: string): number {
  return looseNumber(n, text);
}
function twice(text: string): number {
  const got = strictNumber(hops, text);
  return got + got;
}
function sum(text: string): number {
  let total = 0;
  for (let i = 0; i < 3; i++) total += strictNumber(10, text);
  return total;
}
for (const text of [made("20"), made('"20"')])
  console.log(twice(text), sum(text), Math.floor(strictNumber(3, text) / 3), strictNumber(3, text) | 0);

interface Point {
  x: number;
  y: number;
}
function loosePoint(n: number, text: string): any {
  return n === 0 ? JSON.parse(text) : strictPoint(n - 1, text);
}
function strictPoint(n: number, text: string): Point {
  return loosePoint(n, text);
}
for (const text of [made('{"x":1,"y":2}'), made('{"y":"two"}')]) {
  const point = strictPoint(hops, text);
  console.log(point.x, point.y, JSON.stringify(point));
}

function looseUnion(n: number, text: string): any {
  return n === 0 ? JSON.parse(text) : strictUnion(n - 1, text);
}
function strictUnion(n: number, text: string): boolean | string {
  return looseUnion(n, text);
}
for (const text of ["true", "null", '"text"', "[1,2]", "1.5"].map(made)) {
  const got = strictUnion(hops, text);
  console.log(typeof got, String(got), got === true, got ? "yes" : "no");
}

class Walker {
  loose(n: number): any {
    return n === 0 ? JSON.parse(made("7")) : this.strict(n - 1);
  }
  strict(n: number): number {
    return this.loose(n);
  }
}
console.log(new Walker().strict(hops) + 1);

const table: { loose: (n: number) => any; strict: (n: number) => number } = {
  loose: n => (n === 0 ? JSON.parse(made("7")) : table.strict(n - 1)),
  strict: n => table.loose(n),
};
console.log(table.strict(hops) + 1);

function looseOf<T>(n: number): T {
  return n === 0 ? JSON.parse(made("7")) : (strictOf(n - 1) as unknown as T);
}
function strictOf(n: number): number {
  return looseOf<number>(n);
}
async function later(n: number): Promise<number> {
  return strictOf(n);
}
function* some(n: number): Generator<number, number> {
  yield strictOf(n);
  return strictOf(n);
}
console.log(strictOf(hops), await later(hops), [...some(hops)]);
export {};
