// Flags of a numeric enum are joined, shifted, added and negated, and each answer is stored to a static field of the enum's type. Some answers fit no 32-bit integer.
enum Flag {
  A = 1,
  B = 2,
  C = 1 << 30,
  D = 1 << 31,
}
class Shelf {
  static held: Flag = Flag.A;
}
Shelf.held = Flag.A | Flag.B;
console.log(Shelf.held);
Shelf.held = Flag.C | Flag.D;
console.log(Shelf.held);
Shelf.held = ~Flag.A;
console.log(Shelf.held);
Shelf.held = Flag.D >>> 0;
console.log(Shelf.held);
Shelf.held = Flag.C * 4;
console.log(Shelf.held);
Shelf.held = Flag.C << 2;
console.log(Shelf.held);
Shelf.held = Flag.C + Flag.C;
console.log(Shelf.held);
Shelf.held = -Flag.D;
console.log(Shelf.held);
