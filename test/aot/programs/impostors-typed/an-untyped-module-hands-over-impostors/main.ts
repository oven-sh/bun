import { Box, callBack, counter, makeCount, makeHoles, makeList, makeName, makeNumbers, makePoint, makeShortPoint, makeStep, settings, spoil, spoilCounter } from "./untyped.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");


function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function grown(list: number[]): number {
  return list.push(9);
}

function doubled(list: number[]): number[] {
  return list.map(value => value * 2);
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

function half(n: number): number {
  return n / 2;
}

function code(s: string): number {
  return s.charCodeAt(0) + s.length;
}

function kind(s: string): string {
  return typeof s;
}

function once(f: (n: number) => number): number {
  return f(1) + 1;
}

function honest(label: string): void {
  console.log(label, total([1, 2]), grown([1]), show(doubled([1])), sum({ x: 1, y: 2 }), half(3), code("a"), kind("a"), once(n => n));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i]) + grown([i]) + doubled([i]).length + sum({ x: i, y: 1 }) + half(i) + code("a") + once(n => n);
console.log("2000 honest rounds", warm);

attempt("a subclass: total", () => total(makeList()));
attempt("a subclass: grown", () => grown(makeList()));
attempt("a subclass: doubled", () => doubled(makeList()));
attempt("a string among numbers: total", () => total(makeNumbers()));
attempt("a string among numbers: doubled", () => doubled(makeNumbers()));
attempt("a hole: total", () => total(makeHoles()));
attempt("a hole: doubled", () => doubled(makeHoles()));
attempt("a getter: sum", () => sum(makePoint()));
attempt("a deleted member: sum", () => sum(makeShortPoint()));
attempt("a count that is a string: half", () => half(makeCount()));
attempt("a count that is a string: plus one", () => makeCount() + 1);
attempt("a String object: code", () => code(makeName()));
attempt("a String object: kind", () => kind(makeName()));
attempt("a String object: equality", () => makeName() === "abc");
attempt("a callable proxy: once", () => once(makeStep()));

attempt("settings before", () => half(settings.depth) + code(settings.name) + settings.tags.length);
spoil();
attempt("settings.depth after", () => half(settings.depth));
attempt("settings.name after", () => code(settings.name));
attempt("settings.tags after", () => settings.tags.join("+"));
attempt("settings.tags.length after", () => settings.tags.length);

attempt("counter before", () => half(counter));
spoilCounter();
attempt("counter after", () => half(counter));
attempt("counter after, plus one", () => counter + 1);

attempt("a class of the untyped module", () => {
  const box = new Box(5);
  return half(box.value) + box.grow();
});
attempt("a class of the untyped module with a string", () => {
  const box = new Box("5");
  box.size = hidden("'1'");
  return show(half(box.value)) + show(box.grow());
});
attempt("the untyped module calls back", () => callBack(half));
attempt("the untyped module calls back a method", () => callBack(new (class { k = 2; run = (n: number): number => n * this.k; })().run));

honest("honest after");
