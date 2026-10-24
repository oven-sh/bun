// Symbols in typed code: a declared result type, a unique symbol of a function that runs again, a symbol as the key of an interface, a field of type symbol that a built-in fills.
function show(label: string, value: unknown) {
  console.log(label, typeof value === "symbol" ? String(value) : value);
}

function makeTyped(): symbol { return Symbol("typed"); }
interface Holder { pet?: symbol }
const holder: Holder = {};
Object.defineProperty(holder, "pet", { value: makeTyped(), writable: true, enumerable: true, configurable: true });
show("typed", holder.pet);
show("typed description", holder.pet!.description);

function makeUnique() {
  const unique = Symbol("unique");
  return unique;
}
const firstUnique = makeUnique();
const secondUnique = makeUnique();
show("unique differs", (firstUnique as symbol) !== (secondUnique as symbol));

const mark: unique symbol = Symbol("mark");
interface Marked { [mark]: number }
function makeMarked(): Marked { return { [mark]: 4 }; }
show("marked", makeMarked()[mark]);
show("marked key", Object.getOwnPropertySymbols(makeMarked())[0] === mark);

class Pet {
  mark: symbol;
  constructor(mark: symbol) { this.mark = mark; }
}
function makeForPet(): symbol { return Symbol("pet"); }
const pet = new Pet(makeForPet());
show("pet", pet.mark);
Reflect.set(pet, "mark", makeTyped());
show("pet set", pet.mark);

function makeEither(flag: boolean): symbol | string { return flag ? Symbol("either") : "text"; }
show("either symbol", makeEither(true));
show("either text", makeEither(false));

const makers: Array<() => symbol> = [() => Symbol("a"), () => Symbol("b")];
show("makers", makers.map(make => String(make())).join());
