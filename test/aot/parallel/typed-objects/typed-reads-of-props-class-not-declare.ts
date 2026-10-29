// A typed read of a name that the class does not declare, through an intersection type (the result type of Object.assign) or a cast. One place in the code sees numbers, strings, booleans, undefined, null and objects, properties kept in line and out of line, an accessor where a value was, a deleted property, a property that only the prototype has, and two classes of which one declares the name.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}

class Holder {
  first = 1;
}
class Other {
  first = 2;
  n = 40;
}
type Extended = Holder & { n: number; s: string; b: boolean; u: number | undefined; z: string | null; o: { x: number }; l: number[]; f: () => string };

function numberOf(h: Holder & { n: number }) {
  return h.n + 1;
}
function textOf(h: Holder & { s: string }) {
  return h.s + "!";
}
function flagOf(h: Holder & { b: boolean }) {
  return h.b ? "yes" : "no";
}
function maybeNumberOf(h: Holder & { u: number | undefined }) {
  return h.u === undefined ? "none" : h.u * 2;
}
function maybeTextOf(h: Holder & { z: string | null }) {
  return h.z === null ? "null" : h.z.length;
}
function innerOf(h: Holder & { o: { x: number } }) {
  return h.o.x;
}
function listOf(h: Holder & { l: number[] }) {
  return h.l.length;
}
function callOf(h: Holder & { f: () => string }) {
  return h.f();
}
function mixedOf(h: Holder & { m: number | string | boolean | null | undefined }) {
  return typeof h.m + ":" + String(h.m);
}
function numberOfEither(h: (Holder | Other) & { n: number }) {
  return h.n;
}

const make = (i: number): Extended =>
  Object.assign(new Holder(), {
    n: i % 3 ? i : i + 0.5,
    s: "s" + i,
    b: i % 2 === 0,
    u: i % 4 ? i : undefined,
    z: i % 5 ? "z".repeat(i % 7) : null,
    o: { x: i },
    l: [i, i],
    f: () => "f" + i,
  });

say("every kind, at one place each", () => {
  const seen: unknown[] = [];
  for (let i = 0; i < 12; i++) {
    const h = make(i);
    seen.push([numberOf(h), textOf(h), flagOf(h), maybeNumberOf(h), maybeTextOf(h), innerOf(h), listOf(h), callOf(h)]);
  }
  return seen;
});
say("one place, many kinds of value", () => {
  const seen: unknown[] = [];
  for (const m of [1, "two", true, null, undefined, 2.5, false, -0, "", 1e300, 7]) seen.push(mixedOf(Object.assign(new Holder(), { m })));
  return seen;
});
say("in line and out of line", () => {
  const seen: unknown[] = [];
  for (let count = 0; count < 12; count++) {
    const before: Record<string, number> = {};
    for (let i = 0; i < count; i++) before["k" + i] = i;
    const h = Object.assign(new Holder(), before, { n: count * 10 });
    seen.push(numberOf(h));
  }
  return seen;
});
say("stored again, deleted, made an accessor, made again", () => {
  const seen: unknown[] = [];
  const h = Object.assign(new Holder(), { n: 1, s: "s" });
  seen.push(numberOf(h), numberOf(h));
  h.n = 5;
  seen.push(numberOf(h));
  (h as any).n = 6.5;
  seen.push(numberOf(h));
  let reads = 0;
  Object.defineProperty(h, "n", { get() { return ++reads * 100; }, configurable: true, enumerable: true });
  seen.push(numberOf(h), numberOf(h), reads);
  Object.defineProperty(h, "n", { value: 9, writable: true, configurable: true, enumerable: true });
  seen.push(numberOf(h), textOf(h));
  delete (h as any).s;
  Object.assign(h, { s: "again" });
  seen.push(textOf(h), numberOf(h), Object.keys(h).join());
  return seen;
});
say("the prototype has it where the object does not", () => {
  const seen: unknown[] = [];
  class Based {
    first = 1;
  }
  const read = (b: Based & { n: number }) => b.n;
  (Based.prototype as any).n = 70;
  const plain = new Based() as Based & { n: number };
  const tagged = Object.assign(new Based(), { other: 1 }) as unknown as Based & { n: number };
  const own = Object.assign(new Based(), { other: 1, n: 71 });
  for (let turn = 0; turn < 3; turn++) seen.push(read(plain), read(tagged), read(own));
  (Based.prototype as any).n = 80;
  seen.push(read(plain), read(tagged), read(own));
  delete (own as any).n;
  seen.push(read(own));
  return seen;
});
say("two classes, one of which declares the name", () => {
  const seen: unknown[] = [];
  for (let turn = 0; turn < 4; turn++) {
    seen.push(numberOfEither(Object.assign(new Holder(), { n: turn, extra: 1 })));
    seen.push(numberOfEither(Object.assign(new Other(), { extra: 1 })));
    seen.push(numberOfEither(Object.assign(new Other(), { n: turn + 100, extra: 1 })));
  }
  return seen;
});
say("many objects, so that collections fall between the reads", () => {
  let sum = 0;
  let text = 0;
  for (let i = 0; i < 30000; i++) {
    const h = make(i);
    sum += numberOf(h) + innerOf(h) + listOf(h);
    text += textOf(h).length + callOf(h).length;
  }
  return [sum, text];
});

console.log(lines.join("\n"));
