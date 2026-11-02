// Instances of a class get many keys that the class does not declare. Fields are removed and created again behind those keys, so the order of the keys has fields in the middle.
// Then keys go: from the end, from the front, at random, one object after the other and several in turns, with symbols among them. The order is printed all along.
class Record {
  first = 1;
  second = "s";
  third?: number;
  fourth?: string;
}
let seed = 12345;
function random(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed % limit;
}
function digest(o: object): string {
  let hash = 0;
  const keys = Reflect.ownKeys(o);
  for (const key of keys) {
    const text = String(key);
    for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
    hash = (Math.imul(hash, 31) + 7) | 0;
  }
  const names = Object.keys(o);
  return keys.length + ":" + hash + ":" + names.slice(0, 3).join() + ".." + names.slice(-3).join();
}
function fill(o: any, from: number, to: number) {
  for (let i = from; i < to; i++) o["k" + i] = i;
}
function again(o: any, name: string, value: unknown) {
  delete o[name];
  o[name] = value;
}
const lines: string[] = [];
function removeInOrder(title: string, count: number, order: (i: number) => number, prepare: (o: any) => void) {
  const o: any = new Record();
  fill(o, 0, count);
  prepare(o);
  lines.push(title + " " + count + " at first " + digest(o));
  for (let i = 0; i < count; i++) {
    delete o["k" + order(i)];
    if (i % Math.max(1, count >> 3) === 0) lines.push(title + " " + i + " " + digest(o));
  }
  lines.push(title + " at last " + digest(o));
}
for (const count of [3, 40, 300, 3000, 70000]) {
  const shuffled = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) { const j = random(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const oneField = (o: any) => again(o, "second", "again");
  const twoFields = (o: any) => { again(o, "second", "again"); fill(o, count, count + (count >> 1)); o.third = 3; fill(o, count * 2, count * 2 + 5); };
  const fiveTimes = (o: any) => { for (let i = 0; i < 5; i++) { again(o, i & 1 ? "first" : "second", i); o["more" + i] = i; } o.third = 1; o["last"] = 1; o.fourth = "f"; };
  const withSymbols = (o: any) => { o[Symbol.for("a")] = 1; again(o, "second", "again"); o[Symbol.for("b")] = 2; };
  const outOfItsSlot = (o: any) => { Object.defineProperty(o, "first", { get() { return 9; }, enumerable: true, configurable: true }); again(o, "second", "again"); };
  for (const [name, prepare] of Object.entries(count > 3000 ? { oneField, twoFields } : { oneField, twoFields, fiveTimes, withSymbols, outOfItsSlot })) {
    removeInOrder(name + " from the end", count, i => count - 1 - i, prepare);
    removeInOrder(name + " from the front", count, i => i, prepare);
    removeInOrder(name + " at random", count, i => shuffled[i], prepare);
  }
}
// Everything at once, on several objects in turns.
const objects: any[] = Array.from({ length: 11 }, () => new Record());
const alive: number[][] = objects.map(() => []);
let next = 0;
for (let step = 0; step < 60000; step++) {
  const which = random(objects.length);
  const o = objects[which];
  const keys = alive[which];
  const choice = random(100);
  if (choice < 45 || keys.length === 0) { o["k" + next] = next; keys.push(next++); }
  else if (choice < 85) { const at = choice < 60 ? keys.length - 1 : choice < 70 ? 0 : random(keys.length); delete o["k" + keys[at]]; keys.splice(at, 1); }
  else if (choice < 90) again(o, ["first", "second", "third", "fourth"][random(4)], step);
  else if (choice < 93) delete o[["third", "fourth"][random(2)]];
  else if (choice < 95) o[Symbol.for("s" + random(4))] = step;
  else if (choice < 97) delete o[Symbol.for("s" + random(4))];
  else if (choice < 98) Object.defineProperty(o, "first", { value: step, writable: random(2) === 0, enumerable: true, configurable: true });
  else if (choice < 99) delete o["absent" + step];
  else if (step % 7 === 0) Bun.gc(true);
  if (step % 2500 === 0) lines.push(step + " " + which + " " + digest(o));
}
for (const o of objects) lines.push(digest(o));
console.log(lines.join("\n"));
