// The objects that hold the private names are made in a third function. A private method is asked for beside a private field.
// Flags: --aot-threads=1
class Plank {
  #grain = 1;
  #knot() { return 2; }
  static count(things: object[], from: number): number {
    let found = 0;
    for (const thing of things) found += #grain in thing ? 1 : 0;
    return found > 1000 ? Plank.count(things, from + 1) : found + from;
  }
  static knots(things: object[], from: number): number {
    let found = 0;
    for (const thing of things) found += #knot in thing ? 1 : 0;
    for (const thing of things) found += #grain in thing ? 100 : 0;
    return found > 10000 ? Plank.knots(things, from + 1) : found + from;
  }
}
class Board extends Plank { wide = 1; }
class Shelf extends Board { long = 2; }
class Ghost extends Board { static kind = 5; ghost = 1; }
function make(kind: number): object {
  switch (kind % 4) {
    case 0: return new Plank();
    case 1: return new Board();
    case 2: return new Shelf();
    default: return { kind };
  }
}
function fill(count: number): object[] {
  const made: object[] = [];
  for (let i = 0; i < count; i++) made.push(make(i));
  return made;
}
const things = fill(40);
console.log(Plank.count(things, 0), Plank.knots(things, 0), Plank.count(things, 1), Plank.knots(things, 1), Ghost.kind);
export {};
