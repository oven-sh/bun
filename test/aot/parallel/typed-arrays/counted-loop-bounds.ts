// A counted loop over a view, whose positions are tested once in front of the loop: every form of counter, test and position, with bounds inside the view, at its end and past it.
type Loop = (a: Uint8Array, n: number) => number;

const lengths = [0, 1, 4, 5, 9];
const bounds = [-1, 0, 1, 3, 4, 5, 9, 10, 2.5, NaN];
const counts = [0, 1, 3, 4, 5, 9, 10];

function viewOf(length: number): Uint8Array {
  const view = new Uint8Array(length);
  for (let i = 0; i < length; i++) view[i] = i * 7 + 1;
  return view;
}

function checksum(a: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * (i + 1);
  return s;
}

function each(name: string, loop: Loop, limits: number[] = bounds) {
  for (const length of lengths) {
    const answers: number[] = [];
    for (const n of limits) answers.push(loop(viewOf(length), n));
    console.log(name, length, answers.join(" "));
  }
}

function up(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i];
  return s;
}

function upWithNext(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] + a[i + 1];
  return s;
}

function upToAndWith(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i <= n; i++) s += a[i];
  return s;
}

function boundOnLeft(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; n > i; i++) s += a[i];
  return s;
}

function leavesWhereTestHolds(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; ; i++) {
    if (i >= n) break;
    s += a[i];
  }
  return s;
}

function down(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = n - 1; i >= 0; i--) s += a[i];
  return s;
}

function downAboveZero(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = n; i > 0; i--) s += a[i - 1];
  return s;
}

function downWhileTruthy(a: Uint8Array, n: number): number {
  let s = 0;
  let i = n;
  while (i--) s += a[i];
  return s;
}

function testAtFoot(a: Uint8Array, n: number): number {
  let s = 0;
  let i = 0;
  do {
    s += a[i];
  } while (++i < n);
  return s;
}

function testAtFootGoingDown(a: Uint8Array, n: number): number {
  let s = 0;
  let i = n;
  do {
    s += a[i];
  } while (--i >= 0);
  return s;
}

function testInTheMiddle(a: Uint8Array, n: number): number {
  let s = 0;
  let i = 0;
  for (;;) {
    s += a[i];
    if (!(i < n)) break;
    i++;
    s += a[i];
  }
  return s;
}

function sumIsTested(a: Uint8Array, n: number): number {
  let s = 0;
  for (let k = 0; k + 1 < n; k++) s += a[k + 1] - a[k];
  return s;
}

function byFour(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i += 4) s += a[i] + a[i + 3];
  return s;
}

function downByThree(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = n - 1; i >= 0; i -= 3) s += a[i];
  return s;
}

function mirrored(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[n - 1 - i];
  return s;
}

function scaled(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i * 2] + a[i * 2 + 1];
  return s;
}

function shifted(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i << 1];
  return s;
}

function negated(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i > -n; i--) s += a[-i];
  return s;
}

function cancelsOut(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i * n - i * n + 2];
  return s;
}

function halfOfBound(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n / 2; i++) s += a[i];
  return s;
}

function rows(a: Uint8Array, n: number): number {
  let s = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) s += a[y * n + x];
  }
  return s;
}

function breaksAtLength(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i >= a.length) break;
    s += a[i];
  }
  return s;
}

function onlySomeTurns(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += a[i - 1];
  }
  return s;
}

function meeting(a: Uint8Array, n: number): number {
  let low = 0;
  let high = n - 1;
  while (low < high) {
    const held = a[low];
    a[low] = a[high];
    a[high] = held;
    low++;
    high--;
  }
  return checksum(a);
}

function stores(a: Uint8Array, n: number): number {
  const out = new Uint8Array(4);
  for (let i = 0; i < n; i++) out[i] = a[i] + 1;
  return checksum(out);
}

function fill(v: Uint8Array, n: number, value: number) {
  for (let i = 0; i < n; i++) v[i] = value;
}

const seen: number[] = [];
function fillsBehindWrites(a: Uint8Array, n: number): number {
  seen.push(n);
  fill(a, n, 3);
  seen.push(n + 1);
  fill(a, n - 1, 5);
  return checksum(a);
}

function next(a: Uint8Array, i: number): number {
  return a[i + 1];
}

function readsInCallee(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += next(a, i);
  return s;
}

function lengthIsBound(a: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] + a[i + n];
  return s;
}

each("up", up);
each("upWithNext", upWithNext);
each("upToAndWith", upToAndWith);
each("boundOnLeft", boundOnLeft);
// Nothing is at or above NaN.
each("leavesWhereTestHolds", leavesWhereTestHolds, bounds.slice(0, -1));
each("down", down);
each("downAboveZero", downAboveZero);
each("downWhileTruthy", downWhileTruthy, counts);
each("testAtFoot", testAtFoot);
each("testAtFootGoingDown", testAtFootGoingDown);
each("testInTheMiddle", testInTheMiddle);
each("sumIsTested", sumIsTested);
each("byFour", byFour);
each("downByThree", downByThree);
each("mirrored", mirrored);
each("scaled", scaled);
each("shifted", shifted);
each("negated", negated);
each("cancelsOut", cancelsOut);
each("halfOfBound", halfOfBound);
each("rows", rows);
each("breaksAtLength", breaksAtLength);
each("onlySomeTurns", onlySomeTurns);
each("meeting", meeting);
each("stores", stores);
each("fillsBehindWrites", fillsBehindWrites);
each("readsInCallee", readsInCallee);
each("lengthIsBound", lengthIsBound);
console.log("seen", seen.length, seen.slice(0, 6).join(" "));

function from(a: Uint8Array, start: number, n: number): number {
  let s = 0;
  for (let i = start; i < n; i++) s += a[i];
  return s;
}

for (const start of [-2, -1, -0, 0, 2, 5, 6, 0.5, NaN]) console.log("from", start, from(viewOf(5), start, 5), from(viewOf(5), start, 6), from(viewOf(5), start, 0));

function floats(a: Float64Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] + a[n - 1 - i];
  return s;
}

function bytes(a: Buffer, n: number): number {
  let s = 0;
  for (let i = n - 1; i >= 0; i--) s += a[i];
  return s;
}

for (const n of bounds) console.log("kinds", n, floats(new Float64Array([0.5, 1.5, 2.5, 4]), n), bytes(Buffer.from("counted"), n));

const resizable: any = new (ArrayBuffer as any)(8, { maxByteLength: 16 });
const follows = new Uint8Array(resizable);
const fixed = new Uint8Array(resizable, 0, 6);
follows.set([1, 2, 3, 4, 5, 6, 7, 8]);
console.log("resizable", up(follows, 8), up(follows, 9), up(fixed, 6), up(fixed, 7), down(follows, 8), byFour(fixed, 6));

function shrinksOnTheWay(a: Uint8Array, buffer: any, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i === 2) buffer.resize(3);
    const element = a[i];
    s += element === undefined ? 100 : element;
  }
  return s;
}

console.log("shrinks", shrinksOnTheWay(follows, resizable, 5), follows.length, fixed.length, up(follows, 3), up(follows, 4), up(fixed, 1), up(fixed, 0));

const gone = viewOf(6);
(gone.buffer as any).transfer();
console.log("detached", gone.length, up(gone, 0), up(gone, 1), down(gone, 0), down(gone, 2), testAtFoot(gone, 0), stores(gone, 2), meeting(gone, 3));
