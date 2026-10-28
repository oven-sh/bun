// TypeScript lets any number into the type of one member of a numeric enum too. A static field of such a type is stored another number and compared with the member.
enum Kind {
  Circle,
  Square,
}
class Current {
  static kind: Kind.Square = Kind.Square;
}
function put(v: Kind.Square) {
  Current.kind = v;
}
function isSquare(): boolean {
  return Current.kind === Kind.Square;
}
console.log(isSquare(), Current.kind);
const circle: number = 0;
put(circle);
console.log(isSquare(), Current.kind);
const seven: number = 7;
put(seven);
console.log(isSquare(), Current.kind);
