// Names that compiled code hands over as values: accessors of literals and classes, methods of a class that is evaluated several times, Object.hasOwn in code that runs once and in a loop, symbols in type tests. A name is one value in every module, before and after collections, and a symbol that is only declared or never read changes nothing.
import { lateLiteral, lateTag, reactLate } from "./late.ts";
// @ts-ignore
import { storeThroughSuper } from "./untyped.js";

const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
const show = (v: unknown): string => (typeof v === "symbol" ? v.toString() : typeof v === "function" ? "function " + v.name : String(JSON.stringify(v)));
function describe(o: object): string {
  return Reflect.ownKeys(o)
    .map(key => {
      const d = Reflect.getOwnPropertyDescriptor(o, key)!;
      return show(key) + ":" + (d.get ? "g" : "") + (d.set ? "s" : "") + ("value" in d ? "v" : "") + (d.enumerable ? "e" : "");
    })
    .join(" ");
}

const tag = Symbol("tag");
const neverRead = Symbol("never read");
declare const onlyDeclared: unique symbol;
interface Marked {
  [onlyDeclared]?: number;
  level: number;
}

function literal(start: number) {
  let held = start;
  return {
    get level() { return held; },
    set level(v: number) { held = v * 2; },
    get [tag]() { return "tagged " + held; },
    get [Symbol.toStringTag]() { return "Literal"; },
    set onlySetter(v: number) { held += v; },
  };
}

function makeClass(suffix: string) {
  return class Made {
    static kind = "made " + suffix;
    method() { return "method " + suffix; }
    get reading() { return "reading " + suffix; }
    set reading(v: string) { suffix = v; }
    [tag]() { return "by symbol " + suffix; }
    static helper() { return "helper " + suffix; }
    ["com" + "puted"]() { return "computed " + suffix; }
    after() { return "after " + suffix; }
  };
}

const stop = Symbol("stop");
const skip = Symbol("skip");
type Signal = typeof stop | typeof skip | number;
function react(signal: Signal): string {
  if (signal === stop) return "stop";
  if (signal === skip) return "skip";
  return "other " + String(signal);
}

function countOwn(o: object, rounds: number): number {
  let count = 0;
  for (let i = 0; i < rounds; i++) {
    if (Object.hasOwn(o, "alpha")) count++;
    if (Object.hasOwn(o, "gamma")) count += 1000;
    if (Object.hasOwn(o, tag)) count += 10;
  }
  return count;
}

function round(title: string) {
  const o = literal(3);
  const marked: Marked = o;
  o.level = 4;
  o.onlySetter = 1;
  console.log(title, "literal:", describe(o), marked.level, o[tag], String(o), Object.getOwnPropertySymbols(o)[0] === tag);

  for (const suffix of ["a", "b"]) {
    const Made = makeClass(suffix);
    const made: any = new Made();
    made.reading = suffix + "!";
    console.log(title, "class:", describe(Made.prototype), "|", describe(Made), "|", made.method(), made.reading, made[tag](), Made.helper(), made.computed(), made.after(), Made.kind);
  }

  const record = { alpha: 1, [tag]: 2 };
  console.log(title, "own:", Object.hasOwn(record, "alpha"), Object.hasOwn(record, "beta"), Object.hasOwn(record, tag), Object.hasOwn(record, lateTag), Object.hasOwn(record, Symbol.iterator), record.hasOwnProperty("alpha"), countOwn(record, 50));

  const signals: any[] = [stop, skip, 3, Symbol("stop"), Symbol.iterator, lateTag, tag];
  console.log(title, "signals:", signals.map(signal => react(signal)).join(), "|", signals.map(signal => reactLate(signal)).join());

  const late = lateLiteral(5);
  late.level = 6;
  console.log(title, "other module:", describe(late), late.level, late[lateTag], (late as any)[tag], Object.getOwnPropertySymbols(late)[0] === lateTag);
  console.log(title, "super:", storeThroughSuper(tag, 7));
}

round("first");
collect();
round("after a collection");
collect();
collect();
round("after more collections");
