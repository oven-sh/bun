// Classes with private names and their heirs in different files.
// Flags: --aot-threads=1
import { Board, Ghost, Shelf, countBoards } from "./heirs";
import { Plank } from "./plank";
const things: object[] = [];
for (let i = 0; i < 40; i++) {
  things.push(i % 4 === 0 ? new Plank() : i % 4 === 1 ? new Board() : i % 4 === 2 ? new Shelf() : { i });
}
function tally(things: object[], from: number): number {
  let found = 0;
  for (let i = from; i < things.length; i++) found += Plank.isPlank(things[i]!) ? 2 : 1;
  return found > 1000 ? tally(things, from + 1) : found;
}
console.log(Plank.count(things, 0), countBoards(things, 0), tally(things, 0), Plank.count(things, 2), countBoards(things, 2), tally(things, 2), Ghost.kind);
