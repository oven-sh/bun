const heard: string[] = [];
function put(target: any, name: string, value: unknown): void {
  target[name] = value;
}
function drop(target: any, name: string): void {
  delete target[name];
}
const word: string = JSON.parse('"set"');
class Desk {
  book: Map<string, number>;
  constructor(book: Map<string, number>) {
    this.book = book;
  }
}
function enter(desk: Desk, amount: () => number): void {
  desk.book.set("rent", amount());
}
async function enterLater(desk: Desk, amount: () => Promise<number>): Promise<void> {
  desk.book.set("rent", await amount());
}
const sizes: number[] = [];
for (let turn = 0; turn < 40; turn++) {
  const desk = new Desk(new Map());
  put(desk.book, word, function (this: Map<string, number>, name: string, value: number) {
    heard.push(name + value);
    return this;
  });
  const amount = () => {
    drop(desk.book, word);
    for (let look = 0; look < turn % 10; look++) desk.book.get("none");
    return turn;
  };
  if (turn % 2) enter(desk, amount);
  else await enterLater(desk, async () => amount());
  sizes.push(desk.book.size);
}
console.log(heard.length, heard[0], heard[39], sizes.reduce((sum, size) => sum + size, 0));
export {};
