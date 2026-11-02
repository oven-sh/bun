// A method, a union of three classes, and a read outside every loop: a record comes into the field through `any` and answers for itself.
// Flags: --aot-heat=everything-is-cold
// Erased types: not built: field-names-three-classes-gets-record is built so
class First {
  size = 1;
  label = "first";
  name(i: number): string {
    return this.label + i + this.size;
  }
}
class Second {
  label = "second";
  extra = [1, 2];
  size = 2;
  name(i: number): string {
    return this.label + i + this.size;
  }
}
class Third {
  name = (i: number): string => "third" + i;
}
type Holder = { id: number; part: First | Second | Third };
function once(holder: Holder): string {
  return holder.part.name(7);
}
function walk(holder: Holder, turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) text = once(holder) + holder.part.name(i);
  return text;
}
class Reader {
  read(i: number): number {
    return i;
  }
}
type Shelf = { id: number; part: Reader };
const shelf: Shelf = { id: 9, part: new Reader() };
Object.assign(shelf, { ["part"]: { read: 5 } });
const above = { read: (i: number) => i * 2, count: 0 };
const below = Object.create(above);
const record = { tags: [1], port: 80, host: "h", secure: true, size: "none", name(i: number) { return "record" + i + this.size; } };
const holders: Holder[] = [{ id: 0, part: new First() }, { id: 1, part: new Second() }, { id: 2, part: new Third() }, { id: 3, part: new First() }];
(holders[3] as any)["part"] = record;
for (const holder of holders) console.log(holder.id, once(holder), walk(holder, 5000));
console.log(below.read(1), typeof shelf.part.read);
