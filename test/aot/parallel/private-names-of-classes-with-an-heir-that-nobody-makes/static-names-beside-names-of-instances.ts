// A static private name and a private name of instances, each asked for in loops.
// Flags: --aot-threads=1
class Plank {
  static #made = 1;
  #grain = 1;
  static accepts(things: unknown[], from: number): number {
    let found = 0;
    for (let i = from; i < things.length; i++) { const thing = things[i]; if (typeof thing === "function") found += #made in thing ? 1 : 0; }
    return found > 1000 ? Plank.accepts(things, from + 1) : found;
  }
  static count(things: unknown[], from: number): number {
    let found = 0;
    for (let i = from; i < things.length; i++) { const thing = things[i]; if (typeof thing === "object" && thing !== null) found += #grain in thing ? 1 : 0; }
    return found > 1000 ? Plank.count(things, from + 1) : found;
  }
  static weigh(things: unknown[], from: number): number {
    let found = 0;
    for (let i = from; i < things.length; i++) { const thing = things[i]; if (typeof thing === "object" && thing !== null) found += #grain in thing ? 3 : 1; }
    return found > 1000 ? Plank.weigh(things, from + 1) : found;
  }
}
class Board extends Plank { wide = 1; }
class Ghost extends Board { static kind = 5; ghost = 1; }
const things: unknown[] = [Plank, 5, null];
for (let i = 0; i < 40; i++) things.push(i % 3 === 0 ? new Plank() : i % 3 === 1 ? new Board() : { i });
console.log(Plank.accepts(things, 0), Plank.count(things, 0), Plank.weigh(things, 0), Plank.count(things, 4), Plank.weigh(things, 4), Ghost.kind);
export {};
