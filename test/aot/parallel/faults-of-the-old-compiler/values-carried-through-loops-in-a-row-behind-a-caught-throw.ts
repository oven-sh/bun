// Two locals are carried through several loops in a row; the first loop makes one of them an integer under a handler, later loops copy each into the other.
const O1 = { id: 1 };
let S = "";
let N = 0;
function same(any) { }
function full() { if (S.length > 400000) throw 1; }
function f(x: any){
  let w7: any, w8: any;
  let b: any = O1, a: any = x;
  const box: any = { }, other: any = 1;
  a++;
  for (let i1 = 0; i1 < 1; i1++) {
    full(), ++N;
    try { if (2 == a) throw 1; b |= 0} catch (err) { }
  }
  for (let i2 = 0; i2 < 2; i2++) {
    full()+ (1 + a), ++N;
    b = a = b; full(), S += + (+ a), ++N;
    b = a}
  while (a > 0) { a--;
    if (Number.isInteger(a)) {
      b -= a; }
    if ("id" in b) {
      if (b !== b) for (let i = 0; i < 3; i++) b = a;
      other+ b + (w8 = box, + w8)} {
      const g7 = () => -a;
      if (0 === b && a ) g7();
      if ((a) === a) { (b); S += (- a), ++N}
      S += -a;
      for (let i8 = 0; i8 < 2; i8++) {
      }
    }
    a >>>= 16; }
  S += + a+ (w7 = box+ w7), ++N;
  if (a) {
    if (1 / a ) { b += 1; S += (a (b | 0)), ++N} else S += ((b | 0)), ++N;
    if ((b ) === b) if (a?.id === a?.id) a ||= (b), ++N;
        if (a) for (let i12 = 0; i12 < 2; i12++) {
        }
      if ((a) === a) { same(b); S += ++N}
      S += " " , ++N}
  }
for (let round = 0; round < 3; round++) try { f(undefined); } catch { }
console.log(String(N), String(S.length));
export {};
