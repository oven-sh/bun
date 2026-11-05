// One function has callers with and without the optional member.
interface Task {
  id: number;
  due?: number;
}

function describe(t: Task): string {
  const copy = { ...t };
  return [t.id, t.due, "due" in t, Object.keys(t).join("+"), JSON.stringify(t), "due" in copy, (t.due ?? 0) + 1].join(" ");
}

function withCallerOne(): string {
  return describe({ id: 1, due: 10 });
}

function withCallerTwo(): string {
  const t: Task = { id: 2, due: 20 };
  return describe(t);
}

function withMany(): number {
  let total = 0;
  for (let i = 0; i < 2000; i++) total += describe({ id: i, due: i }).length;
  return total;
}

function withoutCaller(): string {
  return describe({ id: 3 });
}

function undefinedCaller(): string {
  return describe({ id: 4, due: undefined });
}

function flippedCaller(): string {
  return describe({ due: 50, id: 5 });
}

function deletedCaller(): string {
  const t: Task = { id: 6, due: 60 };
  delete t.due;
  return describe(t);
}

function addedCaller(): string {
  const t: Task = { id: 7 };
  t.due = 70;
  return describe(t);
}

const registry = { describe };
const key: keyof typeof registry = "describe";

class Board {
  printer: (t: Task) => string = describe;
  print(t: Task): string {
    return this.printer(t);
  }
}

console.log("without, first of all: " + withoutCaller());
console.log("with, one: " + withCallerOne());
console.log("with, two: " + withCallerTwo());
console.log("with, 2000 times: " + withMany());
console.log("without: " + withoutCaller());
console.log("undefined: " + undefinedCaller());
console.log("flipped: " + flippedCaller());
console.log("deleted: " + deletedCaller());
console.log("added: " + addedCaller());
console.log("with again: " + withCallerOne());

console.log("call, without: " + describe.call(undefined, { id: 8 }));
console.log("apply, undefined: " + describe.apply(undefined, [{ id: 9, due: undefined }]));
console.log("bind, without: " + describe.bind(undefined, { id: 10 })());
console.log("Reflect.apply, with: " + Reflect.apply(describe, undefined, [{ id: 11, due: 1 }]));
console.log("by a computed name, without: " + registry[key]({ id: 12 }));
console.log("through a field, undefined: " + new Board().print({ id: 13, due: undefined }));

const mixed: Task[] = [{ id: 14 }, { id: 15, due: 1 }, { id: 16, due: undefined }, { due: 2, id: 17 }];
console.log("a built-in calls it:");
for (const line of mixed.map(t => describe(t))) console.log("  " + line);
console.log("sorted by due: " + [...mixed].sort((a, b) => (a.due ?? -1) - (b.due ?? -1)).map(t => t.id).join());
console.log("those that have it: " + mixed.filter(t => "due" in t).map(t => t.id).join());
console.log("those where it is defined: " + mixed.filter(t => t.due !== undefined).map(t => t.id).join());

console.log("a promise reaction, without: " + (await Promise.resolve<Task>({ id: 18 }).then(describe)));
console.log("with, at the end: " + withCallerTwo());

export {};
