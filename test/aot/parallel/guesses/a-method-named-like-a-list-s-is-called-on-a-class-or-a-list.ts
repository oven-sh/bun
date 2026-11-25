class Ledger {
  rows: string[] = [];
  length = 0;
  push(row: string) {
    this.rows.push(row);
    this.length += row.length;
    return this.length;
  }
}
class Loud extends Ledger {
  push(row: string) {
    return super.push(row.toUpperCase()) + 1000;
  }
}
class Shelf extends Array<string> {
  push(...rows: string[]) {
    return super.push(...rows) + 500;
  }
}
function feed(out: string[] | Ledger, row: string) {
  return out.push(row);
}
function feedWhatIsMade(out: string[] | Ledger, make: () => string) {
  return out.push(make()) + out.push(make());
}
function measure(out: string[] | Ledger) {
  return out.length;
}
function attempt(what: () => unknown) {
  try {
    return String(what());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const said: string[] = [];
const plain = new Ledger();
const list: string[] = [];
const loud = new Loud();
const shelf = new Shelf();
const withOwn = new Ledger();
(withOwn as any).push = (row: string) => "own " + row;
const listWithOwn: string[] = [];
(listWithOwn as any).push = (row: string) => "own of the list " + row;
const frozen = Object.freeze(new Ledger());
const asked: string[] = [];
const watched = new Proxy(new Ledger(), { get(target, name, receiver) { asked.push(String(name)); return Reflect.get(target, name, receiver); } });
const below = Object.create(plain);
const literal = { length: 7, push(row: string) { return "literal " + row; } };
const receivers: unknown[] = [plain, list, loud, shelf, withOwn, listWithOwn, frozen, watched, below, literal, null, undefined, 5, "text", { length: 1 }];
for (let round = 0; round < 3; round++) {
  for (const receiver of receivers) {
    said.push(attempt(() => feed(receiver as Ledger, "ab")));
    said.push(attempt(() => measure(receiver as Ledger)));
  }
}
let made = 0;
said.push(attempt(() => feedWhatIsMade(plain, () => "m" + made++)));
said.push(attempt(() => feedWhatIsMade(list, () => "m" + made++)));
const former = Ledger.prototype.push;
said.push(attempt(() => feedWhatIsMade(plain, () => { Ledger.prototype.push = function () { return -1; }; return "swapped"; })));
said.push(attempt(() => feed(plain, "behind the swap")));
said.push(attempt(() => feed(loud, "behind the swap")));
Ledger.prototype.push = former;
said.push(attempt(() => feed(plain, "back")));
Object.setPrototypeOf(plain, { push() { return "another prototype"; } });
said.push(attempt(() => feed(plain, "x")));
console.log(said.join("\n"));
console.log(asked.join(","), plain.rows.length, list.length, loud.rows.join("|"), shelf.length, made);
