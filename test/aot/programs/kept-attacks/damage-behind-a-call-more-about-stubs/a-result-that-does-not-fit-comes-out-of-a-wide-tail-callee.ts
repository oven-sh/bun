// `narrow` promises a Point and keeps the promise through a call in tail position of `wide`, which promises the same and tests what it returns. In some rounds `wide` returns something else.
// Build it with --aot-disable=ChooseCallingConventions, with clean returns and with --aot-disable=CleanReturns: then no caller reserves the stack words of a tail call, the fourteen arguments lie in a frame of their own,
// and the word on top of the stack where `wide` returns is the address of the stub that drops that frame. Whoever looks only that word up finds no landing,
// and the value arrives at the plain return point of `holder`, which tests nothing and reads fields in place.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let other: any = null;
function wide(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number): Point {
  if (other !== null) return other;
  return new Point(a + c + e + g + i + k + m, b + d + f + h + j + l + n);
}

function narrow(y: number): Point {
  return wide(y, y + 1, y + 2, y + 3, y + 4, y + 5, y + 6, y + 7, y + 8, y + 9, y + 10, y + 11, y + 12, y + 13);
}

function holder(y: number): string {
  const got = narrow(y);
  return got.x + "," + got.y;
}

const misfits: any[] = [7, "text", { y: 1 }, [1, 2], true, 0.5, { x: "a", y: "b", z: "c" }];

let digest = 0;
for (let round = 0; round < 400; round++) {
  const lies = round % 50 === 49;
  other = lies ? misfits[(round / 50) % misfits.length | 0] : null;
  const line = holder(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || lies) console.log(round + ": " + line);
}
console.log("digest " + digest);
