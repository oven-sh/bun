const heard: string[] = [];
function put(target: any, name: string, value: unknown): void {
  target[name] = value;
}
function hang(target: any, under: any): void {
  Object.setPrototypeOf(target, under);
}
const word: string = JSON.parse('"set"');
function ownWay(this: Map<string, number>, name: string, value: number) {
  heard.push(name + value);
  return this;
}
class Ledger extends Map<string, number> {}
class Daybook extends Ledger {}
put(Ledger.prototype, word, ownWay);
class Desk {
  book: Map<string, number>;
  constructor(book: Map<string, number>) {
    this.book = book;
  }
}
function enter(desk: Desk, amount: () => number): void {
  desk.book.set("rent", amount());
}
const sizes: number[] = [];
for (let turn = 0; turn < 40; turn++) {
  hang(Daybook.prototype, Ledger.prototype);
  const desk = new Desk(new Daybook());
  enter(desk, () => {
    hang(Daybook.prototype, Map.prototype);
    for (let look = 0; look < turn % 10; look++) desk.book.get("none");
    return turn;
  });
  sizes.push(desk.book.size);
}
console.log(heard.length, heard[0], heard[39], sizes.reduce((sum, size) => sum + size, 0));
export {};
