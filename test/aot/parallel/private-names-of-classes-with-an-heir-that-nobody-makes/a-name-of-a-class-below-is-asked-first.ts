// A function that asks for the private name of a class below before it asks for that of the class above.
// Flags: --aot-threads=1
class Plank {
  #grain = 1;
  static isPlank(thing: object): boolean { return #grain in thing; }
  static count(things: object[], from: number): number {
    let found = 0;
    for (let i = from; i < things.length; i++) found += #grain in things[i]! ? 1 : 0;
    return found > 1000 ? Plank.count(things, from + 1) : found;
  }
}
class Board extends Plank {
  #edge = 2;
  static both(things: object[], from: number): string {
    let edges = 0;
    let planks = 0;
    for (let i = from; i < things.length; i++) edges += #edge in things[i]! ? 1 : 0;
    for (let i = from; i < things.length; i++) planks += Plank.isPlank(things[i]!) ? 1 : 0;
    return edges > 1000 ? Board.both(things, from + 1) : edges + " of " + planks;
  }
}
class Shelf extends Board {}
class Beam extends Board { long = 3; }
class Ghost extends Shelf { static kind = 3; ghost = 1; }
const things: object[] = [];
for (let i = 0; i < 40; i++) {
  things.push(
    [() => new Plank(), () => new Board(), () => new Shelf(), () => new Beam(), () => ({ i })][i % 5]!(),
  );
}
console.log(Board.both(things, 1), Plank.count(things, 3), Board.both(things, 1), Plank.count(things, 3), Ghost.kind);
export {};
