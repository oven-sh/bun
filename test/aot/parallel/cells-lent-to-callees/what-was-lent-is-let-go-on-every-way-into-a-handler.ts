// An object or a closure over a large array is lent, and the callee throws. The ways into a handler: a catch that reads what it caught . a finally that a throw enters and leaves again .
// a loan made in a handler's own block, which throws on to the outer handler . a loop in which every other turn throws. Behind each of them nobody can reach the array any more, not even the last one. (The fourteen sums that live across a call use up the registers and places in which a dead copy of its address might lie.)
// Skip under ASAN: the executable printed "aFinally | 297 stays" and "aLoop | 741 stays" where plain Bun printed "gone". Without the sanitizer the same build lets go at the head of every handler, also with a collection forced there: what stays is a word in a native frame.
// Skip on linux arm64 under --aot-harden=proof-checks: there that build prints "aLoanInAHandler | 223 stays" where plain Bun and every other build print "gone", and so does that build on x64. Where the caller asks for the collection, behind the return of the function, that build prints "gone" there too: what holds the array lies in the frame or the registers of the function itself. In which place is not traced
// This program says "gone" only while the fourteen sums overwrite such a dead copy. Make them doubles (plus(0.5, s)), or give the loop of plus() nine turns or more so that it is no longer written out, and they lie in
// other places of the frame: aLoanInAHandler then says "stays" for the object, until the function returns. That is no loan that is kept: the words of what was lent are zeroed all the same. `bun <file>` has such copies too.
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const w: any = unseen("w");

function make(n: number): any {
  return n > 0 ? new Uint8Array(n).fill(1) : n;
}

function look(o: any): number {
  let t = 0;
  for (let i = 0; i < 2; i++) t += o.data.length + o.first.length;
  if (t > 8) throw new RangeError("full");
  return t;
}

function twice(run: () => number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const sum = run() + run() + work;
  if (sum > 8) throw new RangeError("full");
  return sum;
}

function fails(n: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (n + work > 0) throw new RangeError("empty");
  return work;
}

function plus(a: number, b: number): number {
  let t = 0;
  for (let i = 0; i < 2; i++) t += a + b;
  return t;
}

function aCatchThatReads(n: number, kind: number): string {
  let s = 0;
  try {
    if (kind) s += look({ first: w, data: make(n) });
    else { const d = make(n); s += twice(() => d.length + w.length); }
  } catch (e: any) { s += e.message.length; }
  const k0 = plus(0, s), k1 = plus(1, s), k2 = plus(2, s), k3 = plus(3, s), k4 = plus(4, s), k5 = plus(5, s), k6 = plus(6, s), k7 = plus(7, s), k8 = plus(8, s), k9 = plus(9, s), k10 = plus(10, s), k11 = plus(11, s), k12 = plus(12, s), k13 = plus(13, s);
  s = (s + plus(k0, k1) + k0 + k1 + k2 + k3 + k4 + k5 + k6 + k7 + k8 + k9 + k10 + k11 + k12 + k13 + make(0)) | 0; // @ts-expect-error
  return s + (Bun.gc(true) > n / 2 ? " stays" : " gone");
}

function aFinally(n: number, kind: number): string {
  let s = 0;
  try {
    try {
      if (kind) s += look({ first: w, data: make(n) });
      else { const d = make(n); s += twice(() => d.length + w.length); }
    } finally { s += 2; }
  } catch { s++; }
  const k0 = plus(0, s), k1 = plus(1, s), k2 = plus(2, s), k3 = plus(3, s), k4 = plus(4, s), k5 = plus(5, s), k6 = plus(6, s), k7 = plus(7, s), k8 = plus(8, s), k9 = plus(9, s), k10 = plus(10, s), k11 = plus(11, s), k12 = plus(12, s), k13 = plus(13, s);
  s = (s + plus(k0, k1) + k0 + k1 + k2 + k3 + k4 + k5 + k6 + k7 + k8 + k9 + k10 + k11 + k12 + k13 + make(0)) | 0; // @ts-expect-error
  return s + (Bun.gc(true) > n / 2 ? " stays" : " gone");
}

function aLoanInAHandler(n: number, kind: number): string {
  let s = 0;
  try {
    try { s += fails(n); } catch {
      if (kind) s += look({ first: w, data: make(n) });
      else { const d = make(n); s += twice(() => d.length + w.length); }
    }
  } catch { s++; }
  const k0 = plus(0, s), k1 = plus(1, s), k2 = plus(2, s), k3 = plus(3, s), k4 = plus(4, s), k5 = plus(5, s), k6 = plus(6, s), k7 = plus(7, s), k8 = plus(8, s), k9 = plus(9, s), k10 = plus(10, s), k11 = plus(11, s), k12 = plus(12, s), k13 = plus(13, s);
  s = (s + plus(k0, k1) + k0 + k1 + k2 + k3 + k4 + k5 + k6 + k7 + k8 + k9 + k10 + k11 + k12 + k13 + make(0)) | 0; // @ts-expect-error
  return s + (Bun.gc(true) > n / 2 ? " stays" : " gone");
}

function aLoop(n: number, kind: number): string {
  let s = 0;
  for (let turn = 0; turn < 6; turn++) {
    try {
      if (kind) s += look({ first: w, data: make(turn % 2 ? n : 1) });
      else { const d = make(turn % 2 ? n : 1); s += twice(() => d.length + w.length); }
    } catch { s++; }
  }
  const k0 = plus(0, s), k1 = plus(1, s), k2 = plus(2, s), k3 = plus(3, s), k4 = plus(4, s), k5 = plus(5, s), k6 = plus(6, s), k7 = plus(7, s), k8 = plus(8, s), k9 = plus(9, s), k10 = plus(10, s), k11 = plus(11, s), k12 = plus(12, s), k13 = plus(13, s);
  s = (s + plus(k0, k1) + k0 + k1 + k2 + k3 + k4 + k5 + k6 + k7 + k8 + k9 + k10 + k11 + k12 + k13 + make(0)) | 0; // @ts-expect-error
  return s + (Bun.gc(true) > n / 2 ? " stays" : " gone");
}

const ways = [aCatchThatReads, aFinally, aLoanInAHandler, aLoop];
for (const way of ways) { way(unseen(1024), 0); way(unseen(1024), 1); }
for (const way of ways) console.log(way.name, "|", way(unseen(16 * 1024 * 1024), 1), "|", way(unseen(16 * 1024 * 1024), 0));
