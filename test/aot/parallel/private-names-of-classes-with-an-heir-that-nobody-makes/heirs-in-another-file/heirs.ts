import { Plank } from "./plank";
export class Board extends Plank {
  #edge = 1;
  static isBoard(thing: object): boolean { return #edge in thing; }
}
export class Shelf extends Board { long = 2; }
export class Ghost extends Board { static kind = 5; ghost = 1; }
export function countBoards(things: object[], from: number): number {
  let found = 0;
  for (let i = from; i < things.length; i++) found += (Board.isBoard(things[i]!) ? 1 : 0) + (Plank.isPlank(things[i]!) ? 10 : 0);
  return found > 1000 ? countBoards(things, from + 1) : found;
}
