// A static field declared `1 | 2` is stored 7, which reaches the parameter of that type as `any`.
class Shelf {
  static held: 1 | 2 = 1;
}
function put(v: 1 | 2) {
  Shelf.held = v;
}
const seven: any = 7;
put(seven);
console.log(typeof Shelf.held, Shelf.held, Shelf.held === 1, Shelf.held + 1);
