// A declaration file says what a .js file makes, and lies: `size` is written a number and is a text, `owner` a class and is a list. What a declaration file writes arrives expected, so no slot is held to it,
// and what checked code writes with ITS types is only expected too. The field that checked code writes with a type of its own is held, and gets the lie by a store: there the field leaves its slot.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
import { makeThing, Thing } from "./lies.js";

class Keeper {
  thing: Thing;
  size: number;
  constructor(thing: Thing) {
    this.thing = thing;
    this.size = thing.size;
  }
}
function attempt(read: () => unknown): string {
  try {
    return String(read());
  } catch (error) {
    return (error as Error).name;
  }
}
function show(keeper: Keeper): string {
  return (keeper.size + 1) + " " + typeof keeper.size + " " + (keeper.thing.size + 1) + " " + attempt(() => keeper.thing.owner.name.length) + " " + (keeper.thing instanceof Thing);
}
console.log("straight", show(new Keeper(makeThing(1))));
for (let turn = 0; turn < 3; turn++) {
  const keeper = new Keeper(makeThing(turn));
  const before = show(keeper);
  keeper.size = turn;
  console.log(turn, before, "|", show(keeper));
}
