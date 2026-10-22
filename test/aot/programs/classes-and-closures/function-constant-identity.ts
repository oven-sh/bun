// A top-level function has one function object, however many functions name it: every mention is identical, and a property set through one mention is read through the others, also after a collection. Built-in functions and symbols read in functions that run once are identical to the ones read in a loop. A nested function is a new object at each evaluation, with or without captured variables.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

type Unary = (x: number) => number;

function increment(x: number): number {
  return x + 1;
}

function nameDirectly(): Unary {
  return increment;
}

function nameInArray(): Unary {
  const list: Unary[] = [increment];
  return list[0];
}

function nameInObject(): Unary {
  const holder = { callee: increment };
  return holder.callee;
}

function allocateGarbage(): number {
  let total = 0;
  for (let i = 0; i < 50000; i++) {
    const garbage = { index: i, text: "garbage " + i };
    total += garbage.text.length;
  }
  return total;
}

(nameDirectly() as any).tag = "tagged";
console.log("garbage", allocateGarbage());
collect();
console.log("property after a collection", (nameInArray() as any).tag, (nameInObject() as any).tag, Object.keys(nameDirectly()).join());

const mentions: Unary[] = [nameDirectly(), nameInArray(), nameInObject(), increment];
console.log("one identity", mentions.every(mention => mention === increment), new Set(mentions).size, mentions[1](41), mentions[2].name, mentions[3].length);

let identicalInLoop = 0;
for (let i = 0; i < 1000; i++) {
  if (nameDirectly() === mentions[i % mentions.length]) identicalInLoop++;
}
console.log("identical in a loop", identicalInLoop);

delete (nameInObject() as any).tag;
console.log("property deleted", String((nameDirectly() as any).tag), Object.keys(increment).length);

function coldMax(): unknown {
  return Math.max;
}

function coldPush(): unknown {
  return Array.prototype.push;
}

function coldIterator(): unknown {
  return Symbol.iterator;
}

const max = coldMax();
const push = coldPush();
const iterator = coldIterator();
let identicalBuiltins = 0;
for (let i = 0; i < 1000; i++) {
  if (Math.max === max) identicalBuiltins++;
  if (Array.prototype.push === push) identicalBuiltins++;
  if (Symbol.iterator === iterator) identicalBuiltins++;
}
console.log("built-ins in a loop", identicalBuiltins);
collect();
console.log("built-ins after a collection", coldMax() === max, coldPush() === push, coldIterator() === iterator);
console.log("built-ins are different cells", max === push, (max as (...values: number[]) => number)(3, 9, 4), (push as Function).name, String(iterator));

function createAdder(amount: number): Unary {
  return x => x + amount;
}

function createSeven(): () => number {
  return function seven() {
    return 7;
  };
}

const addOne = createAdder(1);
const addOneAgain = createAdder(1);
(addOne as any).tag = "first";
console.log("with a capture", addOne === addOneAgain, addOne === addOne, addOne(1), addOneAgain(1), String((addOneAgain as any).tag));

const seven = createSeven();
(seven as any).tag = "first";
console.log("without a capture", seven === createSeven(), seven(), createSeven()(), String((createSeven() as any).tag));

const closures = new Set<Function>();
for (let i = 0; i < 100; i++) {
  closures.add(createAdder(i % 2));
  closures.add(createSeven());
  closures.add(nameDirectly());
}
console.log("distinct closures", closures.size);
export {};
