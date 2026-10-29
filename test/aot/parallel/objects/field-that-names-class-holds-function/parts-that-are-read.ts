const pass = new Function("value", "return value") as <T>(value: T) => T;
function put(target: any, key: string, value: unknown): void {
  target[key] = value;
}
class Part {
  words: string[] = ["a", "b", "c"];
  count: number = 3;
  read = (i: number): string => this.words[i % this.words.length] + this.count;
}
class Alike {
  read(i: number): string {
    return "alike" + i;
  }
}
type Holder = { id: number; part: Part | Alike };
const holder: Holder = { id: 0, part: new Part() };
Object.assign(holder, { ["part"]: { read: 5 } });
class Words {
  words: string[] = ["a", "b", "c"];
}
type Shelf = { id: number; part?: Words };
const record = { secure: true, port: 80, read: (i: number) => i * 2, open: null, weight: 1.5, count: 0 };
const shelf: Shelf = { id: 1, part: new Words() };
put(shelf, pass("part"), Object.create(record));
console.log(typeof holder.part.read, (shelf.part as any).read(2));
