// A spread into a literal of a declared type, from sources that hold names outside the type, hold the type's names elsewhere, or hold values that the type's slots do not take.
// Each kind of copy is made many times: the first few are made in other ways than the rest.
type Point = { a: number; b: number; c: string; d: number };
type Wide = Point & { label: number };

const lines: string[] = [];
function show(name: string, value: unknown) {
  lines.push(name + ": " + JSON.stringify(value) + " | " + Object.keys(value as object).join(","));
}

function alone(point: Point): Point {
  return { ...point };
}
function inFront(point: Point, i: number): Wide {
  return { ...point, label: i };
}
function behind(point: Point, i: number): Wide {
  return { label: i, ...point };
}

function parsed(text: string): Point {
  return JSON.parse(text);
}
function grown(i: number, names: string[]): Point {
  const made: any = { a: i, b: i + 1, c: "c" + (i % 3), d: i + 2 };
  for (const name of names) made[name] = name + i;
  return made;
}
function filled(i: number, names: string[]): Point {
  const made: any = {};
  for (const name of names) made[name] = name === "c" ? "s" + (i % 2) : i + name.length;
  return made;
}

const makers: [string, (i: number) => Point][] = [
  ["parsed, one more name", i => parsed(`{"a":${i},"b":2,"c":"x","d":4,"e":${i + 1}}`)],
  ["parsed, two more names", i => parsed(`{"a":${i},"e":1,"b":2,"c":"x","f":"f${i}","d":4}`)],
  ["parsed, three more names", i => parsed(`{"e":[${i}],"a":${i},"b":2.5,"c":"x","d":4,"f":null,"g":{"h":${i}}}`)],
  ["parsed, twelve names", i => parsed(`{"a":${i},"b":2,"c":"x","d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"j":10,"k":11,"l":${i}}`)],
  ["parsed, twenty names", i => parsed("{" + Array.from({ length: 20 }, (_, k) => `"${"abcdefghijklmnopqrst"[k]}":${k === 2 ? '"x"' : i + k}`).join(",") + "}")],
  ["parsed, names missing", i => parsed(`{"a":${i},"z":1,"d":4}`)],
  ["grown by one", i => grown(i, ["late"])],
  ["grown by two", i => grown(i, ["late", "later"])],
  ["grown by five", i => grown(i, ["p", "q", "r", "s", "t"])],
  ["another literal", i => ({ a: i, d: 2, e: i + 0.5 }) as any],
  ["a third literal", i => ({ z: "z" + i, a: i, c: "c", y: i % 2 === 0, x: null, w: undefined }) as any],
  ["filled by key", i => filled(i, ["a", "b", "c", "d"])],
  ["filled by key in another order", i => filled(i, ["d", "c", "extra", "b", "a"])],
  ["filled by key, many", i => filled(i, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])],
];

for (const [name, make] of makers) {
  let sum = 0;
  for (let i = 0; i < 60; i++) {
    const source = make(i);
    const first = alone(source);
    const second = inFront(source, i);
    const third = behind(source, i);
    sum += first.a + second.label + third.label + Object.keys(second).length;
    if (i === 0 || i === 3 || i === 59) {
      show(name + " alone " + i, first);
      show(name + " in front " + i, second);
      show(name + " behind " + i, third);
    }
    // The copy has its own properties.
    (first as any).late = "changed";
    (first as any).e = "changed";
    (second as any).added = i;
    if (i === 59) {
      show(name + " source afterwards", source);
      show(name + " changed", first);
      show(name + " added to", second);
    }
  }
  lines.push(name + " sum " + sum);
}

// One odd value among many: the copy that is under way is given up and made in another way.
const odd: [string, (i: number) => any][] = [
  ["a string for a number", i => parsed(`{"a":${i === 40 ? '"forty"' : i},"b":2,"c":"x","d":4,"e":5,"f":6,"g":7}`)],
  ["a number for a string", i => parsed(`{"a":1,"b":2,"c":${i === 41 ? 41 : '"x"'},"d":4,"e":5,"f":6,"g":7}`)],
  ["null in the last field", i => parsed(`{"a":1,"b":2,"c":"x","d":${i === 42 ? "null" : i},"e":5,"f":6,"g":7}`)],
  ["a fraction", i => parsed(`{"a":${i === 43 ? 0.25 : i},"b":2,"c":"x","d":4,"e":5}`)],
  ["a large number", i => parsed(`{"a":${i === 44 ? 1e300 : i},"b":${i === 45 ? -0 : 2},"c":"x","d":${i === 46 ? 2147483648 : 4},"e":5}`)],
  ["undefined in a grown literal", i => {
    const made: any = grown(i, ["late", "later"]);
    if (i === 47) made.b = undefined;
    if (i === 48) made.later = undefined;
    return made;
  }],
  ["a name deleted", i => {
    const made: any = grown(i, ["late", "later", "last"]);
    if (i === 49) delete made.later;
    if (i === 50) delete made.c;
    return made;
  }],
];
for (const [name, make] of odd) {
  for (let i = 0; i < 60; i++) {
    const source = make(i);
    const first = alone(source);
    const second = inFront(source, i);
    if (i >= 39 && i <= 51) {
      show(name + " alone " + i, first);
      show(name + " in front " + i, second);
    }
  }
}

// Two kinds of source take turns, and the collector runs in between.
let kept: unknown[] = [];
let total = 0;
for (let i = 0; i < 30000; i++) {
  const source = i % 2 ? grown(i, ["late", "later", "last"]) : parsed(`{"a":${i},"b":2,"c":"x","d":4,"e":5,"f":6,"g":7,"h":[${i}]}`);
  const copy: any = inFront(source, i);
  total += copy.a + copy.label + (copy.h ? copy.h[0] : copy.last.length);
  if (i % 1000 === 0) kept.push(copy);
  if (i % 7000 === 0) Bun.gc(true);
}
lines.push("total " + total);
for (const copy of kept) show("kept", copy);

console.log(lines.join("\n"));
