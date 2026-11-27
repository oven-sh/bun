export class Plank {
  #grain = 1;
  static isPlank(thing: object): boolean { return #grain in thing; }
  static count(things: object[], from: number): number {
    let found = 0;
    for (let i = from; i < things.length; i++) found += #grain in things[i]! ? 1 : 0;
    return found > 1000 ? Plank.count(things, from + 1) : found;
  }
}
