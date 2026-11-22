// Eight times a function hands a small test an object that holds a large array made for that call alone; each of the eight objects has a size of its own.
// Behind each call nobody can reach the array any more, however long the function goes on: a full collection behind the eighth call finds all eight gone.
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const u: any = unseen(0);

function make(n: number): any {
  return n > 0 ? new Uint8Array(n).fill(1) : n;
}

function look(o: any): number {
  let t = 0;
  for (let i = 0; i < 2; i++) t += o.data.length + o.id;
  return t;
}

function phases(n: number): string {
  let s = 0;
  s += look({ id: 1, data: make(n) });
  s += look({ id: 2, data: make(n), a: u, b: u });
  s += look({ id: 3, data: make(n), a: u, b: u, c: u, d: u });
  s += look({ id: 4, data: make(n), a: u, b: u, c: u, d: u, e: u, f: u });
  s += look({ id: 5, data: make(n), a: u, b: u, c: u, d: u, e: u, f: u, g: u, h: u });
  s += look({ id: 6, data: make(n), a: u, b: u, c: u, d: u, e: u, f: u, g: u, h: u, i: u, j: u });
  s += look({ id: 7, data: make(n), a: u, b: u, c: u, d: u, e: u, f: u, g: u, h: u, i: u, j: u, k: u, l: u });
  s += look({ id: 8, data: make(n), a: u, b: u, c: u, d: u, e: u, f: u, g: u, h: u, i: u, j: u, k: u, l: u, m: u, n: u });
  const size = Bun.gc(true); // @ts-expect-error
  return s + " " + (size > 4 * n);
}

console.log(phases(unseen(8 * 1024 * 1024)));
