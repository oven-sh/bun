// What is remembered about the shape of a class's instances ends with the shape, and the prototype object of the class may change at any time after that.
import { edenGC } from "bun:jsc";

class Kept0 { a = 0; }
class Kept1 { a = 1; b = "b"; }
class Kept2 extends Kept0 { c = 2; }
class Kept3 extends Kept1 { d = [3]; }
class Kept4 { e = 4; f = 4.5; g = "g"; }
class Kept5 extends Kept4 { h = null; }
class Kept6 { i = { inner: 6 }; }
class Kept7 extends Kept6 { j = 7; k = 8; }
class Gone0 { a = 0; }
class Gone1 { a = 1; b = "b"; }
class Gone2 extends Gone0 { c = 2; }
class Gone3 extends Gone1 { d = [3]; }
class Gone4 { e = 4; f = 4.5; g = "g"; }
class Gone5 extends Gone4 { h = () => "h"; }
class Gone6 {
  declare late: () => string;
  early = () => "early";
  constructor() {
    this.late = () => "late";
  }
}

function describe(value: object): string {
  return JSON.stringify(value) + " " + String(value) + " " + Object.prototype.toString.call(value) + " " + (value as any) * 1;
}

function fill(depth: number): number {
  const some = [depth, depth + 1, depth + 2, depth + 3, depth + 4, depth + 5];
  return depth ? fill(depth - 1) + some.length : some.length;
}

let length = 0;
const makers: (() => object)[] = [() => new Gone0(), () => new Gone1(), () => new Gone2(), () => new Gone3(), () => new Gone4(), () => new Gone5(), () => new Gone6()];
const otherPrototypes = makers.map(make => Object.create(Object.getPrototypeOf(make())));
function lookAtOne(index: number, round: number): void {
  length += describe(makers[index]()).length;
  const more: any = makers[index]();
  more["more" + round] = round;
  length += describe(more).length + Object.keys(more).length;
  length += describe(Object.setPrototypeOf(makers[index](), otherPrototypes[index])).length;
}

const kept = [new Kept0(), new Kept1(), new Kept2(), new Kept3(), new Kept4(), new Kept5(), new Kept6(), new Kept7()];
const gone = [Gone0, Gone1, Gone2, Gone3, Gone4, Gone5, Gone6];
for (const each of kept) length += describe(each).length;
Bun.gc(true);

for (let round = 0; round < 4; round++) {
  for (const [index, each] of gone.entries()) {
    lookAtOne(index, round);
    length += fill(40);
    if (round % 2) edenGC();
    else Bun.gc(true);
    Object.defineProperty(each.prototype, "toJSON", { value() { return "round " + round; }, configurable: true, writable: true });
    Object.defineProperty(each.prototype, Symbol.toStringTag, { value: each.name + round, configurable: true });
    (each.prototype as any)["added" + round] = round;
  }
  console.log(length, makers.map(make => describe(make())).join(" | "));
  for (const each of gone) {
    delete (each.prototype as any).toJSON;
    delete (each.prototype as any)[Symbol.toStringTag];
  }
  length += fill(40);
  Bun.gc(true);
}

async function isItself(index: number): Promise<boolean> {
  const made: any = makers[index]();
  made.more = index;
  return (await made) === made;
}
for (const [index, each] of gone.entries()) {
  console.log(await isItself(index));
  length += fill(40);
  Bun.gc(true);
  Bun.gc(true);
  (each.prototype as any).then = function (resolve: (value: string) => void) { resolve("thenable " + each.name); };
}
console.log((await Promise.all(makers.map(make => make()))).join());
console.log(kept.map(describe).join(" | "));
