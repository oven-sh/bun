// Values that no analysis can see through.
const outside: any = JSON.parse(process.argv[3] ?? '{"numbers":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],"one":1,"rounds":200000}');
const section: string = process.argv[2] ?? "all";

// 2a: an awaited call of a typed async function with an argument that the caller has not proven.
async function load(id: number): Promise<number> {
  if (id < 0) await null;
  return id + 1;
}
async function run(x: any): Promise<number> {
  return await load(x);
}
async function awaits(): Promise<number> {
  let result = 0;
  for (let round = 0; round < outside.rounds; round++) result += await run(outside.one);
  return result;
}

// 2b: a typed helper that calls its callback, too large to inline, called with a list that the caller has not proven.
function each(xs: number[], f: (x: number) => void): void {
  let i = 0;
  for (; i + 7 < xs.length; i += 8) {
    f(xs[i]); f(xs[i + 1]); f(xs[i + 2]); f(xs[i + 3]); f(xs[i + 4]); f(xs[i + 5]); f(xs[i + 6]); f(xs[i + 7]);
  }
  for (; i + 3 < xs.length; i += 4) {
    f(xs[i]); f(xs[i + 1]); f(xs[i + 2]); f(xs[i + 3]);
  }
  for (; i < xs.length; i++) f(xs[i]);
  for (let j = xs.length - 1; j >= 0; j--) f(-xs[j]);
  for (let j = xs.length - 1; j >= 0; j -= 2) f(xs[j] * 2);
}
function sumOf(list: any): number {
  let sum = 0;
  each(list, x => { sum += x; });
  return sum;
}
function maxOf(list: any): number {
  let max = -1000;
  each(list, x => { if (x > max) max = x; });
  return max;
}
function countOf(list: any): number {
  let count = 0;
  each(list, () => { count++; });
  return count;
}
function callbacks(): number {
  let result = 0;
  for (let round = 0; round < outside.rounds; round++) result += sumOf(outside.numbers) + maxOf(outside.numbers) + countOf(outside.numbers);
  return result;
}

// 6: tests of `kind` in front of a use as one member of the union.
interface Id { kind: 80; text: string }
interface Num { kind: 9; value: number }
interface Str { kind: 11; text: string; quoted: boolean }
type Piece = Id | Num | Str;
function isId(n: Piece): n is Id {
  return n.kind === 80;
}
function isIdOrNothing(n: Piece | undefined): n is Id {
  return n !== undefined && n.kind === 80;
}
function guardBehindTest(n: Piece | undefined): string | undefined {
  if (n !== undefined && isId(n)) return n.text;
  return undefined;
}
function guardThatTests(n: Piece | undefined): string | undefined {
  if (isIdOrNothing(n)) return n.text;
  return undefined;
}
function optionalChain(n: Piece | undefined): string | undefined {
  if (n?.kind === 80) return n.text;
  return undefined;
}
function kindInVariable(n: Piece | null): string | undefined {
  if (!n) return undefined;
  const kind = n.kind;
  if (kind === 80) return (n as Id).text;
  if (kind === 11) return (n as Str).text;
  return undefined;
}
function throughAny(value: any): string | undefined {
  const n: Piece | undefined = value;
  if (n && n.kind === 80) return n.text;
  return undefined;
}
class Holder { piece: Piece | undefined = undefined; }
function fieldOfHolder(h: Holder): string | undefined {
  const n = h.piece;
  if (n !== undefined && isId(n)) return n.text;
  return undefined;
}
const pieces: (Piece | undefined)[] = [{ kind: 80, text: "a" }, { kind: 9, value: 3 }, { kind: 11, text: "s", quoted: true }, undefined];
function guards(): number {
  let result = 0;
  const holder = new Holder();
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      holder.piece = piece;
      result += (guardBehindTest(piece) ?? "").length + (guardThatTests(piece) ?? "").length + (optionalChain(piece) ?? "").length
        + (kindInVariable(piece ?? null) ?? "").length + (throughAny(piece) ?? "").length + (fieldOfHolder(holder) ?? "").length;
    }
  }
  return result;
}

// 7: an object created below a prototype that gets an accessor: returned at once, or from a variable.
function createdTail(p: object | null): any {
  return Object.create(p);
}
function createdLocal(p: object | null): any {
  const o = Object.create(p);
  return o;
}
function accessors(): number {
  let result = 0;
  const proto = { base: 1 };
  for (let round = 0; round < 1000; round++) {
    const t = createdTail(proto);
    Object.defineProperty(t, "size", { get() { return 3; }, enumerable: true, configurable: true });
    const l = createdLocal(proto);
    Object.defineProperty(l, "width", { get() { return 4; }, enumerable: true, configurable: true });
    result += t.size + t.base + l.width + l.base;
  }
  return result;
}

async function main() {
  if (section === "awaits" || section === "all") console.log("awaits", await awaits());
  if (section === "callbacks" || section === "all") console.log("callbacks", callbacks());
  if (section === "rest" || section === "all") console.log("rest", guards(), accessors());
}
main();
