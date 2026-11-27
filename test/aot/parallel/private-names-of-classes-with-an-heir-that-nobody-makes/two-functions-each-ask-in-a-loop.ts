// Two functions that each ask in a loop which objects hold a private name.
// Flags: --aot-threads=1
class Plank {
  #grain = 1;
  static count(things: object[], from: number): number {
    let found = 0;
    for (let i = from; i < things.length; i++) found += #grain in things[i]! ? 1 : 0;
    return found > 1000 ? Plank.count(things, from + 1) : found;
  }
  static weigh(things: object[], from: number): number {
    let weight = 0;
    for (let i = from; i < things.length; i++) weight += #grain in things[i]! ? 3 : 1;
    return weight > 1000 ? Plank.weigh(things, from + 1) : weight;
  }
}
class Board extends Plank { wide = 1; }
class Shelf extends Board { long = 2; }
class Ghost extends Plank { static kind = 5; ghost = 1; }
const things: object[] = [];
for (let i = 0; i < 40; i++) {
  things.push(i % 4 === 0 ? new Plank() : i % 4 === 1 ? new Board() : i % 4 === 2 ? new Shelf() : { i });
}
console.log(Plank.count(things, 0), Plank.weigh(things, 0), Plank.count(things, 3), Plank.weigh(things, 3), Ghost.kind);
export {};
