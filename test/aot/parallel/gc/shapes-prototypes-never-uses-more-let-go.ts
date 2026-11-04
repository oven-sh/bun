// What a program has learned about a shape outlives the objects of that shape. It does not outlive the prototype that the shape hangs on, and it keeps no prototype alive; and a program that gives its objects new names for ever does not grow.
import { fullGC, heapStats } from "bun:jsc";

class Message {
  url: string;
  constructor(url: string) { this.url = url; }
}

function structures(): number {
  let sum = 0;
  for (const [name, count] of Object.entries(heapStats().objectTypeCounts)) if (name.includes("Structure")) sum += count as number;
  return sum;
}
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    fullGC();
  }
}

function underNewPrototype(i: number, watched: WeakRef<object>[]): number {
  const prototype: any = Object.create(Message.prototype);
  prototype.helper = function () { return i; };
  const message: any = new Message("/" + i);
  Object.setPrototypeOf(message, prototype);
  message.params = i;
  message.route = "route";
  if (i % 20 === 0) watched.push(new WeakRef(prototype));
  return message.helper() + message.params + message.route.length + message.url.length;
}

function withNewNames(i: number): number {
  const message: any = new Message("/" + i);
  message["name" + i] = i;
  message["other" + i] = i + 1;
  const plain: any = {};
  plain["key" + i] = i;
  return message["name" + i] + message["other" + i] + plain["key" + i];
}

let sum = 0;
const watched: WeakRef<object>[] = [];
for (let i = 0; i < 200; i++) sum += underNewPrototype(i, []) + withNewNames(i);
await settle();
const before = structures();

for (let round = 0; round < 10; round++) {
  for (let i = 0; i < 400; i++) sum += underNewPrototype(round * 400 + i, watched);
  await settle();
}
const alive = watched.filter(ref => ref.deref() !== undefined).length;
console.log("prototypes watched:", watched.length, "nearly all are gone:", alive <= 3);
console.log("no more Structures than before:", structures() - before < 100);

for (let round = 0; round < 10; round++) {
  for (let i = 0; i < 2000; i++) sum += withNewNames(1000 + round * 2000 + i);
  await settle();
}
console.log("nor behind twenty thousand new names:", structures() - before < 100);
console.log(sum);
