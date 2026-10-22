// A function with one parameter calls a function with fourteen in tail position. The wide one catches what a callee throws behind the damage and returns as usual. The unwinder makes it dirty.
// Build it with --aot-disable=ChooseCallingConventions: then no caller reserves the stack words of a tail call, the wide one returns into the stub that drops the frame of its arguments,
// and the address to replace lies in the record of that frame, not above the frame of the function that catches.
// The call under the handler counts in full for the callers, so the answers are right either way: add --aot-validate, where a swap that was lost is a dirty event behind a clean return.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let victim: Point | null = null;
function deep(n: number): number {
  const target = victim;
  if (target === null) return n;
  victim = null;
  delete (target as any).x;
  throw new RangeError("behind the damage");
}

function wide(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number): number {
  let got = 0;
  try {
    got = deep(a + n);
  } catch {
    got = -1;
  }
  return got + a + b + c + d + e + f + g + h + i + j + k + l + m + n;
}

function narrow(y: number): number {
  return wide(y, y + 1, y + 2, y + 3, y + 4, y + 5, y + 6, y + 7, y + 8, y + 9, y + 10, y + 11, y + 12, y + 13);
}

function holder(q: Point): string {
  const before = q.x + q.y;
  const got = narrow(q.y);
  return before + " " + got + " " + q.x + "," + q.y + "," + ("x" in q);
}

function outer(round: number, strikes: boolean): string {
  const q = new Point(round + 0.5, round + 1);
  const before = q.x + q.y;
  if (strikes) victim = q;
  const inner = holder(q);
  return before + " [" + inner + "] " + q.x + "," + q.y + "," + ("x" in q);
}

let digest = 0;
for (let round = 0; round < 400; round++) {
  const strikes = round === 150 || round === 151 || round === 399;
  const line = outer(round, strikes);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || strikes) console.log(round + ": " + line);
}
console.log("digest " + digest);
