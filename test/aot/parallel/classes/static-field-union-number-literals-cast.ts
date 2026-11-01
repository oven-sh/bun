// A static field declared `1 | 2` is stored 2 ** 31, 7 and what `& 3` leaves of a number, each behind `as 1 | 2`.
class Shelf {
  static held: 1 | 2 = 1;
}
function put(v: number) {
  Shelf.held = v as 1 | 2;
}
function putMasked(v: number) {
  Shelf.held = (v & 3) as 1 | 2;
}
put(2 ** 31);
console.log(typeof Shelf.held, Shelf.held, Shelf.held === 1);
put(7);
console.log(typeof Shelf.held, Shelf.held, Shelf.held === 1);
for (const v of [4, 5, 6, 7]) {
  putMasked(v);
  console.log(Shelf.held, Shelf.held === 1, Shelf.held === 2);
}
