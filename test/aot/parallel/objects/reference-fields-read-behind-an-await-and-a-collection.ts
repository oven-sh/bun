// Fields that hold references alone are read in front of an await, the heap is collected while the function is suspended, and what was read is used behind it.
class Leaf {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
class Holder {
  a: Leaf;
  b: Leaf;
  c: Leaf | undefined;
  d: Leaf | undefined;
  constructor(i: number) {
    this.a = new Leaf("a" + i);
    this.b = new Leaf("b" + i);
    this.c = i & 1 ? new Leaf("c" + i) : undefined;
    this.d = undefined;
  }
}
function collect() {
  (globalThis as any).Bun.gc(true);
}
async function deed(holder: Holder) {
  const a = holder.a;
  const c = holder.c;
  holder.a = new Leaf("replaced");
  await null;
  collect();
  const again = holder.a;
  await null;
  collect();
  return a.name + " " + (c ? c.name : "none") + " " + again.name + " " + holder.b.name + " " + String(holder.d);
}
async function main() {
  console.log(await deed(new Holder(0)));
  let all = "";
  for (let i = 0; i < 6; i++) all += (await deed(new Holder(i))) + ";";
  console.log(all);
  const both = await Promise.all([deed(new Holder(7)), deed(new Holder(8))]);
  console.log(both.join(";"));
}
main();
