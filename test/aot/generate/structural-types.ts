// The programs of structural-types that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { family, programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "a-list-of-numbers-gets-holes-and-other-lengths-inside-the-loop-that-reads-it.ts": text(
      `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}
`,
      [
        `the kind of an element	typeof list[1] === "number"
the sum of three elements	list[0] + list[1] + list[2] === 6
the length	list.length === 3
whether an element is there	1 in list
indexOf	list.indexOf(2) === 1
includes	list.includes(2)
at	list.at(1) === 2
reduce	list.reduce((a, b) => a + b, 0) === 6
every	list.every(n => typeof n === "number")
join	list.join() === "1,2,3"`,
        (n, a, b) => `attempt("an element is deleted, ${a}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (${b}) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});`,
      ],
      `attempt("an element is deleted, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("an element is deleted, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.deleteProperty(list, 1);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();`,
      [
        `list.join()	the kind of an element	typeof list[1] === "number"
typeof list[1] + " " + list.length	the sum of three elements	list[0] + list[1] + list[2] === 6
typeof list[1] + " " + list.length	the length	list.length === 3
typeof list[1] + " " + list.length	whether an element is there	1 in list
typeof list[1] + " " + list.length	indexOf	list.indexOf(2) === 1
typeof list[1] + " " + list.length	includes	list.includes(2)
typeof list[1] + " " + list.length	at	list.at(1) === 2
typeof list[1] + " " + list.length	reduce	list.reduce((a, b) => a + b, 0) === 6
typeof list[1] + " " + list.length	every	list.every(n => typeof n === "number")
typeof list[1] + " " + list.length	join	list.join() === "1,2,3"`,
        (n, a, b, c) => `  }
  return held + " " + ${a};
});
attempt("the length is set to five, ${b}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (${c}) held++;`,
      ],
      `  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("the length is set to five, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.set(list, "length", 5);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();`,
      [
        `list.join()	the kind of an element	typeof list[1] === "number"
typeof list[1] + " " + list.length	the sum of three elements	list[0] + list[1] + list[2] === 6
typeof list[1] + " " + list.length	the length	list.length === 3
typeof list[1] + " " + list.length	whether an element is there	1 in list
typeof list[1] + " " + list.length	indexOf	list.indexOf(2) === 1
typeof list[1] + " " + list.length	includes	list.includes(2)
typeof list[1] + " " + list.length	at	list.at(1) === 2
typeof list[1] + " " + list.length	reduce	list.reduce((a, b) => a + b, 0) === 6
typeof list[1] + " " + list.length	every	list.every(n => typeof n === "number")
typeof list[1] + " " + list.length	join	list.join() === "1,2,3"`,
        (n, a, b, c) => `  }
  return held + " " + ${a};
});
attempt("the length is defined as one, ${b}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (${c}) held++;`,
      ],
      `  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("the length is defined as one, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();`,
      [
        `list.join()	the kind of an element	typeof list[1] === "number"
typeof list[1] + " " + list.length	the sum of three elements	list[0] + list[1] + list[2] === 6
typeof list[1] + " " + list.length	the length	list.length === 3
typeof list[1] + " " + list.length	whether an element is there	1 in list
typeof list[1] + " " + list.length	indexOf	list.indexOf(2) === 1
typeof list[1] + " " + list.length	includes	list.includes(2)
typeof list[1] + " " + list.length	at	list.at(1) === 2
typeof list[1] + " " + list.length	reduce	list.reduce((a, b) => a + b, 0) === 6
typeof list[1] + " " + list.length	every	list.every(n => typeof n === "number")
typeof list[1] + " " + list.length	join	list.join() === "1,2,3"`,
        (n, a, b, c) => `  }
  return held + " " + ${a};
});
attempt("an element far behind the end, ${b}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (${c}) held++;`,
      ],
      `  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("an element far behind the end, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.set(list, 50, 7);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});

export {};
`,
    ),
    "a-list-of-numbers-gets-locks-and-other-prototypes-inside-the-loop-that-reads-it.ts": text(
      `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}
`,
      [
        `the kind of an element	typeof list[1] === "number"
the sum of three elements	list[0] + list[1] + list[2] === 6
the length	list.length === 3
whether an element is there	1 in list
indexOf	list.indexOf(2) === 1
includes	list.includes(2)
at	list.at(1) === 2
reduce	list.reduce((a, b) => a + b, 0) === 6
every	list.every(n => typeof n === "number")
join	list.join() === "1,2,3"`,
        (n, a, b) => `attempt("frozen, ${a}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (${b}) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});`,
      ],
      `attempt("frozen, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("frozen, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.freeze(list);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();`,
      [
        `list.join()	the kind of an element	typeof list[1] === "number"
typeof list[1] + " " + list.length	the sum of three elements	list[0] + list[1] + list[2] === 6
typeof list[1] + " " + list.length	the length	list.length === 3
typeof list[1] + " " + list.length	whether an element is there	1 in list
typeof list[1] + " " + list.length	indexOf	list.indexOf(2) === 1
typeof list[1] + " " + list.length	includes	list.includes(2)
typeof list[1] + " " + list.length	at	list.at(1) === 2
typeof list[1] + " " + list.length	reduce	list.reduce((a, b) => a + b, 0) === 6
typeof list[1] + " " + list.length	every	list.every(n => typeof n === "number")
typeof list[1] + " " + list.length	join	list.join() === "1,2,3"`,
        (n, a, b, c) => `  }
  return held + " " + ${a};
});
attempt("sealed, ${b}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (${c}) held++;`,
      ],
      `  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("sealed, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.seal(list);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();`,
      [
        `list.join()	the kind of an element	typeof list[1] === "number"
typeof list[1] + " " + list.length	the sum of three elements	list[0] + list[1] + list[2] === 6
typeof list[1] + " " + list.length	the length	list.length === 3
typeof list[1] + " " + list.length	whether an element is there	1 in list
typeof list[1] + " " + list.length	indexOf	list.indexOf(2) === 1
typeof list[1] + " " + list.length	includes	list.includes(2)
typeof list[1] + " " + list.length	at	list.at(1) === 2
typeof list[1] + " " + list.length	reduce	list.reduce((a, b) => a + b, 0) === 6
typeof list[1] + " " + list.length	every	list.every(n => typeof n === "number")
typeof list[1] + " " + list.length	join	list.join() === "1,2,3"`,
        (n, a, b, c) => `  }
  return held + " " + ${a};
});
attempt("an element is made read-only, ${b}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (${c}) held++;`,
      ],
      `  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("an element is made read-only, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.defineProperty(list, 1, { writable: false });
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();`,
      [
        `list.join()	the kind of an element	typeof list[1] === "number"
typeof list[1] + " " + list.length	the sum of three elements	list[0] + list[1] + list[2] === 6
typeof list[1] + " " + list.length	the length	list.length === 3
typeof list[1] + " " + list.length	whether an element is there	1 in list
typeof list[1] + " " + list.length	indexOf	list.indexOf(2) === 1
typeof list[1] + " " + list.length	includes	list.includes(2)
typeof list[1] + " " + list.length	at	list.at(1) === 2
typeof list[1] + " " + list.length	reduce	list.reduce((a, b) => a + b, 0) === 6
typeof list[1] + " " + list.length	every	list.every(n => typeof n === "number")
typeof list[1] + " " + list.length	join	list.join() === "1,2,3"`,
        (n, a, b, c) => `  }
  return held + " " + ${a};
});
attempt("the prototype becomes null, ${b}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (${c}) held++;`,
      ],
      `  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("the prototype becomes null, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.setPrototypeOf(list, null);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();`,
      [
        `list.join()	the kind of an element	typeof list[1] === "number"
typeof list[1] + " " + list.length	the sum of three elements	list[0] + list[1] + list[2] === 6
typeof list[1] + " " + list.length	the length	list.length === 3
typeof list[1] + " " + list.length	whether an element is there	1 in list
typeof list[1] + " " + list.length	indexOf	list.indexOf(2) === 1
typeof list[1] + " " + list.length	includes	list.includes(2)
typeof list[1] + " " + list.length	at	list.at(1) === 2
typeof list[1] + " " + list.length	reduce	list.reduce((a, b) => a + b, 0) === 6
typeof list[1] + " " + list.length	every	list.every(n => typeof n === "number")
typeof list[1] + " " + list.length	join	list.join() === "1,2,3"`,
        (n, a, b, c) => `  }
  return held + " " + ${a};
});
attempt("the prototype gets another indexOf, ${b}", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (${c}) held++;`,
      ],
      `  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("the prototype gets another indexOf, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});

export {};
`,
    ),
    "define-property-gives-the-members-of-a-prototype-other-values.ts": text(
      `class Gauge {
  level = 1;
  one(): number {
    return this.level + 1;
  }
  two(): number {
    return this.level + 2;
  }
  three(): number {
    return this.level + 3;
  }
  four(): number {
    return this.level + 4;
  }
  five(): number {
    return this.level + 5;
  }
  get six(): number {
    return this.level + 6;
  }
  get seven(): number {
    return this.level + 7;
  }
  all(): number {
    return this.one() + this.two() + this.three() + this.four() + this.five() + this.six + this.seven;
  }
}

class Fine extends Gauge {
  level = 10;
  superOne(): number {
    return super.one();
  }
  superTwo(): number {
    return super.two();
  }
  superThree(): number {
    return super.three();
  }
  superFour(): number {
    return super.four();
  }
  superFive(): number {
    return super.five();
  }
  superSix(): number {
    return super.six;
  }
  superSeven(): number {
    return super.seven;
  }
}

const before = new Gauge();
const fine = new Fine();

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one	one") + " " + ("one
Two	two	two") + " " + ("two
Three	three	three") + " " + ("three
Four	four	four") + " " + ("four
Five	five	five") + " " + ("five`,
        (n, a, b, c) => `}

function take${a}(g: Gauge): number {
  return g.${b}();
}

function use${a}(label: string): void {
  attempt(label + ", an instance made before", () => before.${b}());
  attempt(label + ", an instance made now", () => new Gauge().${b}());
  attempt(label + ", plus one", () => before.${b}() + 1);
  attempt(label + ", typeof the member", () => typeof before.${b});
  attempt(label + ", is of its kind", () => typeof before.${b} === "function");
  attempt(label + ", is undefined", () => before.${b} === undefined);
  attempt(label + ", a typed function", () => take${a}(before));
  attempt(label + ", a subclass instance", () => fine.${b}());
  attempt(label + ", through super", () => fine.super${a}());
  attempt(label + ", read off the prototype", () => Gauge.prototype.${b}.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "${c}" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.${b}();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      [
        `ix	ix") + " " + ("six
even	even") + " " + ("seven`,
        (n, a, b) => `}

function takeS${a}(g: Gauge): number {
  return g.s${a};
}

function useS${a}(label: string): void {
  attempt(label + ", an instance made before", () => before.s${a});
  attempt(label + ", an instance made now", () => new Gauge().s${a});
  attempt(label + ", plus one", () => before.s${a} + 1);
  attempt(label + ", typeof the member", () => typeof before.s${a});
  attempt(label + ", is of its kind", () => typeof before.s${a} === "number");
  attempt(label + ", is undefined", () => before.s${a} === undefined);
  attempt(label + ", a typed function", () => takeS${a}(before));
  attempt(label + ", a subclass instance", () => fine.s${a});
  attempt(label + ", through super", () => fine.superS${a}());
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "s${b}" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopS${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.s${a};
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useTwo("");
  useThree("");
  useFour("");
  useFive("");
  useSix("");
  useSeven("");
}
quiet = false;

useOne("one, untouched");
loopOne("one becomes another function of its type", () => {
  Object.defineProperty(Gauge.prototype, "one", { value: function (this: Gauge): number {
      return this.level + 100;
    } });
});
useOne("one becomes another function of its type");

useTwo("two, untouched");
loopTwo("two becomes a function that answers a string", () => {
  Object.defineProperty(Gauge.prototype, "two", { value: () => "text" });
});
useTwo("two becomes a function that answers a string");

useThree("three, untouched");
loopThree("three becomes a number", () => {
  Object.defineProperty(Gauge.prototype, "three", { value: 5 });
});
useThree("three becomes a number");

useFour("four, untouched");
loopFour("four becomes undefined", () => {
  Object.defineProperty(Gauge.prototype, "four", { value: undefined });
});
useFour("four becomes undefined");

useFive("five, untouched");
loopFive("five becomes a class", () => {
  Object.defineProperty(Gauge.prototype, "five", { value: class {} });
});
useFive("five becomes a class");

useSix("six, untouched");
loopSix("the getter six becomes a number", () => {
  Object.defineProperty(Gauge.prototype, "six", { value: 600 });
});
useSix("the getter six becomes a number");

useSeven("seven, untouched");
loopSeven("the getter seven becomes a string", () => {
  Object.defineProperty(Gauge.prototype, "seven", { value: "text" });
});
useSeven("the getter seven becomes a string");

export {};
`,
    ),
    "define-property-gives-the-static-members-of-a-class-other-values.ts": text(
      `class Config {
  static one = 1;
  static two = 2;
  static three = 3;
  static word = "word";
  static inner = { depth: 4 };
  static five(): number {
    return Config.one + 5;
  }
  static six(): number {
    return 6;
  }
  static get seven(): number {
    return Config.two + 7;
  }
  static sum(): number {
    return Config.one + Config.two + Config.three + Config.word.length + Config.inner.depth + Config.five() + Config.six() + Config.seven;
  }
  fromAnInstance(): number {
    return Config.one + Config.two + Config.three + Config.inner.depth;
  }
}

class Special extends Config {
  static own = 8;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one + 1	one	one") + " " + ("one
Two	two + 1	two	two") + " " + ("two
Three	three + 1	three	three") + " " + ("three
Word	word.length	word	word") + " " + ("word
Inner	inner.depth	inner	inner") + " " + ("inner
Five	five()	five	five") + " " + ("five
Six	six()	six	six") + " " + ("six
Seven	seven + 1	seven	seven") + " " + ("seven`,
        (n, a, b, c, d) => `}

function take${a}(C: typeof Config): number {
  return C.${b};
}

function use${a}(label: string): void {
  attempt(label + ", used", () => Config.${b});
  attempt(label + ", typeof", () => typeof Config.${c});
  attempt(label + ", is undefined", () => Config.${c} === undefined);
  attempt(label + ", is null or undefined", () => Config.${c} == null);
  attempt(label + ", a typed function", () => take${a}(Config));
  attempt(label + ", through the subclass", () => Special.${b});
  attempt(label + ", a typed function given the subclass", () => take${a}(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "${d}" in Special));
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.${b};
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useTwo("");
  useThree("");
  useWord("");
  useInner("");
  useFive("");
  useSix("");
  useSeven("");
}
quiet = false;

useOne("one, untouched");
loopOne("one becomes a string", () => {
  Object.defineProperty(Config, "one", { value: "text" });
});
useOne("one becomes a string");

useTwo("two, untouched");
loopTwo("two becomes undefined", () => {
  Object.defineProperty(Config, "two", { value: undefined });
});
useTwo("two becomes undefined");

useThree("three, untouched");
loopThree("three becomes a fraction", () => {
  Object.defineProperty(Config, "three", { value: 0.5 });
});
useThree("three becomes a fraction");

useWord("word, untouched");
loopWord("word becomes a number", () => {
  Object.defineProperty(Config, "word", { value: 7 });
});
useWord("word becomes a number");

useInner("inner, untouched");
loopInner("inner becomes null", () => {
  Object.defineProperty(Config, "inner", { value: null });
});
useInner("inner becomes null");

useFive("five, untouched");
loopFive("five becomes a number", () => {
  Object.defineProperty(Config, "five", { value: 5 });
});
useFive("five becomes a number");

useSix("six, untouched");
loopSix("six becomes a function that answers a string", () => {
  Object.defineProperty(Config, "six", { value: () => "text" });
});
useSix("six becomes a function that answers a string");

useSeven("seven, untouched");
loopSeven("the getter seven becomes a string", () => {
  Object.defineProperty(Config, "seven", { value: "text" });
});
useSeven("the getter seven becomes a string");

export {};
`,
    ),
    "object-assign-gives-the-members-of-a-prototype-other-values.ts": text(
      `class Gauge {
  level = 1;
  one(): number {
    return this.level + 1;
  }
  two(): number {
    return this.level + 2;
  }
  three(): number {
    return this.level + 3;
  }
  four(): number {
    return this.level + 4;
  }
  five(): number {
    return this.level + 5;
  }
  get six(): number {
    return this.level + 6;
  }
  get seven(): number {
    return this.level + 7;
  }
  all(): number {
    return this.one() + this.two() + this.three() + this.four() + this.five() + this.six + this.seven;
  }
}

class Fine extends Gauge {
  level = 10;
  superOne(): number {
    return super.one();
  }
  superTwo(): number {
    return super.two();
  }
  superThree(): number {
    return super.three();
  }
  superFour(): number {
    return super.four();
  }
  superFive(): number {
    return super.five();
  }
  superSix(): number {
    return super.six;
  }
  superSeven(): number {
    return super.seven;
  }
}

const before = new Gauge();
const fine = new Fine();

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one	one") + " " + ("one
Two	two	two") + " " + ("two
Three	three	three") + " " + ("three
Four	four	four") + " " + ("four
Five	five	five") + " " + ("five`,
        (n, a, b, c) => `}

function take${a}(g: Gauge): number {
  return g.${b}();
}

function use${a}(label: string): void {
  attempt(label + ", an instance made before", () => before.${b}());
  attempt(label + ", an instance made now", () => new Gauge().${b}());
  attempt(label + ", plus one", () => before.${b}() + 1);
  attempt(label + ", typeof the member", () => typeof before.${b});
  attempt(label + ", is of its kind", () => typeof before.${b} === "function");
  attempt(label + ", is undefined", () => before.${b} === undefined);
  attempt(label + ", a typed function", () => take${a}(before));
  attempt(label + ", a subclass instance", () => fine.${b}());
  attempt(label + ", through super", () => fine.super${a}());
  attempt(label + ", read off the prototype", () => Gauge.prototype.${b}.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "${c}" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.${b}();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      [
        `ix	ix") + " " + ("six
even	even") + " " + ("seven`,
        (n, a, b) => `}

function takeS${a}(g: Gauge): number {
  return g.s${a};
}

function useS${a}(label: string): void {
  attempt(label + ", an instance made before", () => before.s${a});
  attempt(label + ", an instance made now", () => new Gauge().s${a});
  attempt(label + ", plus one", () => before.s${a} + 1);
  attempt(label + ", typeof the member", () => typeof before.s${a});
  attempt(label + ", is of its kind", () => typeof before.s${a} === "number");
  attempt(label + ", is undefined", () => before.s${a} === undefined);
  attempt(label + ", a typed function", () => takeS${a}(before));
  attempt(label + ", a subclass instance", () => fine.s${a});
  attempt(label + ", through super", () => fine.superS${a}());
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "s${b}" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopS${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.s${a};
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useTwo("");
  useThree("");
  useFour("");
  useFive("");
  useSix("");
  useSeven("");
}
quiet = false;

useOne("one, untouched");
loopOne("one becomes another function of its type", () => {
  Object.assign(Gauge.prototype, { one: function (this: Gauge): number {
      return this.level + 100;
    } });
});
useOne("one becomes another function of its type");

useTwo("two, untouched");
loopTwo("two becomes a function that answers a string", () => {
  Object.assign(Gauge.prototype, { two: () => "text" });
});
useTwo("two becomes a function that answers a string");

useThree("three, untouched");
loopThree("three becomes a number", () => {
  Object.assign(Gauge.prototype, { three: 5 });
});
useThree("three becomes a number");

useFour("four, untouched");
loopFour("four becomes undefined", () => {
  Object.assign(Gauge.prototype, { four: undefined });
});
useFour("four becomes undefined");

useFive("five, untouched");
loopFive("five becomes a class", () => {
  Object.assign(Gauge.prototype, { five: class {} });
});
useFive("five becomes a class");

useSix("six, untouched");
loopSix("the getter six becomes a number", () => {
  Object.assign(Gauge.prototype, { six: 600 });
});
useSix("the getter six becomes a number");

useSeven("seven, untouched");
loopSeven("the getter seven becomes a string", () => {
  Object.assign(Gauge.prototype, { seven: "text" });
});
useSeven("the getter seven becomes a string");

export {};
`,
    ),
    "object-assign-gives-the-static-members-of-a-class-other-values.ts": text(
      `class Config {
  static one = 1;
  static two = 2;
  static three = 3;
  static word = "word";
  static inner = { depth: 4 };
  static five(): number {
    return Config.one + 5;
  }
  static six(): number {
    return 6;
  }
  static get seven(): number {
    return Config.two + 7;
  }
  static sum(): number {
    return Config.one + Config.two + Config.three + Config.word.length + Config.inner.depth + Config.five() + Config.six() + Config.seven;
  }
  fromAnInstance(): number {
    return Config.one + Config.two + Config.three + Config.inner.depth;
  }
}

class Special extends Config {
  static own = 8;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one + 1	one	one") + " " + ("one
Two	two + 1	two	two") + " " + ("two
Three	three + 1	three	three") + " " + ("three
Word	word.length	word	word") + " " + ("word
Inner	inner.depth	inner	inner") + " " + ("inner
Five	five()	five	five") + " " + ("five
Six	six()	six	six") + " " + ("six
Seven	seven + 1	seven	seven") + " " + ("seven`,
        (n, a, b, c, d) => `}

function take${a}(C: typeof Config): number {
  return C.${b};
}

function use${a}(label: string): void {
  attempt(label + ", used", () => Config.${b});
  attempt(label + ", typeof", () => typeof Config.${c});
  attempt(label + ", is undefined", () => Config.${c} === undefined);
  attempt(label + ", is null or undefined", () => Config.${c} == null);
  attempt(label + ", a typed function", () => take${a}(Config));
  attempt(label + ", through the subclass", () => Special.${b});
  attempt(label + ", a typed function given the subclass", () => take${a}(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "${d}" in Special));
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.${b};
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useTwo("");
  useThree("");
  useWord("");
  useInner("");
  useFive("");
  useSix("");
  useSeven("");
}
quiet = false;

useOne("one, untouched");
loopOne("one becomes a string", () => {
  Object.assign(Config, { one: "text" });
});
useOne("one becomes a string");

useTwo("two, untouched");
loopTwo("two becomes undefined", () => {
  Object.assign(Config, { two: undefined });
});
useTwo("two becomes undefined");

useThree("three, untouched");
loopThree("three becomes a fraction", () => {
  Object.assign(Config, { three: 0.5 });
});
useThree("three becomes a fraction");

useWord("word, untouched");
loopWord("word becomes a number", () => {
  Object.assign(Config, { word: 7 });
});
useWord("word becomes a number");

useInner("inner, untouched");
loopInner("inner becomes null", () => {
  Object.assign(Config, { inner: null });
});
useInner("inner becomes null");

useFive("five, untouched");
loopFive("five becomes a number", () => {
  Object.assign(Config, { five: 5 });
});
useFive("five becomes a number");

useSix("six, untouched");
loopSix("six becomes a function that answers a string", () => {
  Object.assign(Config, { six: () => "text" });
});
useSix("six becomes a function that answers a string");

useSeven("seven, untouched");
loopSeven("the getter seven becomes a string", () => {
  Object.assign(Config, { seven: "text" });
});
useSeven("the getter seven becomes a string");

export {};
`,
    ),
    "object-set-prototype-of-relinks-an-instance-or-a-class-right-before-the-typed-uses.ts": text(
      `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}`,
      [
        `D1.prototype	the prototype of another class, asked directly", () => (o instanceof C1	the prototype of another class, asked by a typed function", () => ask1	the prototype of another class, asked by a callback", () => [o].filter(q => q instanceof C1	the prototype of another class	the prototype of another class, another instance", () => new C1().value() + " " + (new C1() instanceof C1
null	null, asked directly", () => (o instanceof C2	null, asked by a typed function", () => ask2	null, asked by a callback", () => [o].filter(q => q instanceof C2	null	null, another instance", () => new C2().value() + " " + (new C2() instanceof C2
{ value: () => -2 }	a plain object, asked directly", () => (o instanceof C3	a plain object, asked by a typed function", () => ask3	a plain object, asked by a callback", () => [o].filter(q => q instanceof C3	a plain object	a plain object, another instance", () => new C3().value() + " " + (new C3() instanceof C3
Object.create(C4.prototype)	a child of its own prototype, asked directly", () => (o instanceof C4	a child of its own prototype, asked by a typed function", () => ask4	a child of its own prototype, asked by a callback", () => [o].filter(q => q instanceof C4	a child of its own prototype	a child of its own prototype, another instance", () => new C4().value() + " " + (new C4() instanceof C4`,
        (n, a, b, c, d, e, f) => `
class C${n + 1} {
  level = 1;
  value(): number {
    return this.level;
  }
}

class D${n + 1} {
  level = 2;
  value(): number {
    return -1;
  }
}

function ask${n + 1}(o: C${n + 1}): string {
  return (o instanceof C${n + 1}) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block${n + 1}(): void {
  const o = new C${n + 1}();
  Object.setPrototypeOf(o, ${a});
  attempt("an instance is relinked to ${b}) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("an instance is relinked to ${c}(o));
  attempt("an instance is relinked to ${d}).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("an instance is relinked to ${e}, its method", () => o.value());
  attempt("an instance is relinked to ${e}, its field", () => o.level);
  attempt("an instance is relinked to ${f}));
}

block${n + 1}();`,
      ],
      [
        `5.prototype, D5.prototype	the prototype of another class, asked directly", () => (o instanceof B5	the prototype of another class, asked by a typed function", () => ask5	the prototype of another class, asked by a callback", () => [o].filter(q => q instanceof B5	the prototype of another class	the prototype of another class, still of its own class", () => o instanceof C5	the prototype of another class, an instance of the base", () => new B5
6.prototype, null	null, asked directly", () => (o instanceof B6	null, asked by a typed function", () => ask6	null, asked by a callback", () => [o].filter(q => q instanceof B6	null	null, still of its own class", () => o instanceof C6	null, an instance of the base", () => new B6`,
        (n, a, b, c, d, e, f, g) => `
class B${n + 5} {
  level = 1;
  value(): number {
    return this.level;
  }
  static kind = "base";
}

class C${n + 5} extends B${n + 5} {
  extra = 3;
}

class D${n + 5} {
  level = 2;
  value(): number {
    return -1;
  }
  static kind = "other";
}

function ask${n + 5}(o: B${n + 5}): string {
  return (o instanceof B${n + 5}) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block${n + 5}(): void {
  const o = new C${n + 5}();
  Object.setPrototypeOf(C${a});
  attempt("the prototype of a subclass is relinked to ${b}) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("the prototype of a subclass is relinked to ${c}(o));
  attempt("the prototype of a subclass is relinked to ${d}).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the prototype of a subclass is relinked to ${e}, its method", () => o.value());
  attempt("the prototype of a subclass is relinked to ${e}, its fields", () => o.level + o.extra);
  attempt("the prototype of a subclass is relinked to ${f});
  attempt("the prototype of a subclass is relinked to ${g}().value());
}

block${n + 5}();`,
      ],
      [
        `7, D7	another class, asked directly", () => (typeof C7.kind === "string") + " " + ("kind" in C7) + " " + C7	another class, asked by a typed function", () => ask7(C7	another class, asked by a callback", () => [C7	another class, the base keeps its own", () => B7	another class, what it inherits from", () => Object.getPrototypeOf(C7) === B7
8, Function.prototype	Function.prototype, asked directly", () => (typeof C8.kind === "string") + " " + ("kind" in C8) + " " + C8	Function.prototype, asked by a typed function", () => ask8(C8	Function.prototype, asked by a callback", () => [C8	Function.prototype, the base keeps its own", () => B8	Function.prototype, what it inherits from", () => Object.getPrototypeOf(C8) === B8`,
        (n, a, b, c, d, e, f) => `
class B${n + 7} {
  level = 1;
  value(): number {
    return this.level;
  }
  static kind = "base";
}

class C${n + 7} extends B${n + 7} {
  extra = 3;
}

class D${n + 7} {
  level = 2;
  value(): number {
    return -1;
  }
  static kind = "other";
}

function ask${n + 7}(o: typeof B${n + 7}): string {
  return (typeof o.kind === "string") + " " + ("kind" in o) + " " + o.kind;
}

function block${n + 7}(): void {
  Object.setPrototypeOf(C${a});
  attempt("a subclass is relinked to ${b}.kind);
  attempt("a subclass is relinked to ${c}));
  attempt("a subclass is relinked to ${d}].filter(q => typeof q.kind === "string").length);
  attempt("a subclass is relinked to ${e}.kind);
  attempt("a subclass is relinked to ${f});
}

block${n + 7}();`,
      ],
      `
export {};
`,
    ),
    "reflect-set-gives-the-members-of-a-prototype-other-values.json": text(
      `{ "skipInVariant": { "validate-collecting": "it allocates so much that it runs for minutes where every allocation collects, and a run is killed after 90 seconds" } }
`,
    ),
    "reflect-set-gives-the-members-of-a-prototype-other-values.ts": text(
      `class Gauge {
  level = 1;
  one(): number {
    return this.level + 1;
  }
  two(): number {
    return this.level + 2;
  }
  three(): number {
    return this.level + 3;
  }
  four(): number {
    return this.level + 4;
  }
  five(): number {
    return this.level + 5;
  }
  get six(): number {
    return this.level + 6;
  }
  get seven(): number {
    return this.level + 7;
  }
  all(): number {
    return this.one() + this.two() + this.three() + this.four() + this.five() + this.six + this.seven;
  }
}

class Fine extends Gauge {
  level = 10;
  superOne(): number {
    return super.one();
  }
  superTwo(): number {
    return super.two();
  }
  superThree(): number {
    return super.three();
  }
  superFour(): number {
    return super.four();
  }
  superFive(): number {
    return super.five();
  }
  superSix(): number {
    return super.six;
  }
  superSeven(): number {
    return super.seven;
  }
}

const before = new Gauge();
const fine = new Fine();

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one	one") + " " + ("one
Two	two	two") + " " + ("two
Three	three	three") + " " + ("three
Four	four	four") + " " + ("four
Five	five	five") + " " + ("five`,
        (n, a, b, c) => `}

function take${a}(g: Gauge): number {
  return g.${b}();
}

function use${a}(label: string): void {
  attempt(label + ", an instance made before", () => before.${b}());
  attempt(label + ", an instance made now", () => new Gauge().${b}());
  attempt(label + ", plus one", () => before.${b}() + 1);
  attempt(label + ", typeof the member", () => typeof before.${b});
  attempt(label + ", is of its kind", () => typeof before.${b} === "function");
  attempt(label + ", is undefined", () => before.${b} === undefined);
  attempt(label + ", a typed function", () => take${a}(before));
  attempt(label + ", a subclass instance", () => fine.${b}());
  attempt(label + ", through super", () => fine.super${a}());
  attempt(label + ", read off the prototype", () => Gauge.prototype.${b}.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "${c}" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.${b}();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      [
        `ix	ix") + " " + ("six
even	even") + " " + ("seven`,
        (n, a, b) => `}

function takeS${a}(g: Gauge): number {
  return g.s${a};
}

function useS${a}(label: string): void {
  attempt(label + ", an instance made before", () => before.s${a});
  attempt(label + ", an instance made now", () => new Gauge().s${a});
  attempt(label + ", plus one", () => before.s${a} + 1);
  attempt(label + ", typeof the member", () => typeof before.s${a});
  attempt(label + ", is of its kind", () => typeof before.s${a} === "number");
  attempt(label + ", is undefined", () => before.s${a} === undefined);
  attempt(label + ", a typed function", () => takeS${a}(before));
  attempt(label + ", a subclass instance", () => fine.s${a});
  attempt(label + ", through super", () => fine.superS${a}());
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "s${b}" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loopS${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.s${a};
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useTwo("");
  useThree("");
  useFour("");
  useFive("");
  useSix("");
  useSeven("");
}
quiet = false;

useOne("one, untouched");
loopOne("one becomes another function of its type", () => {
  Reflect.set(Gauge.prototype, "one", function (this: Gauge): number {
      return this.level + 100;
    });
});
useOne("one becomes another function of its type");

useTwo("two, untouched");
loopTwo("two becomes a function that answers a string", () => {
  Reflect.set(Gauge.prototype, "two", () => "text");
});
useTwo("two becomes a function that answers a string");

useThree("three, untouched");
loopThree("three becomes a number", () => {
  Reflect.set(Gauge.prototype, "three", 5);
});
useThree("three becomes a number");

useFour("four, untouched");
loopFour("four becomes undefined", () => {
  Reflect.set(Gauge.prototype, "four", undefined);
});
useFour("four becomes undefined");

useFive("five, untouched");
loopFive("five becomes a class", () => {
  Reflect.set(Gauge.prototype, "five", class {});
});
useFive("five becomes a class");

useSix("six, untouched");
loopSix("the getter six becomes a number", () => {
  Reflect.set(Gauge.prototype, "six", 600);
});
useSix("the getter six becomes a number");

useSeven("seven, untouched");
loopSeven("the getter seven becomes a string", () => {
  Reflect.set(Gauge.prototype, "seven", "text");
});
useSeven("the getter seven becomes a string");

export {};
`,
    ),
    "reflect-set-gives-the-static-members-of-a-class-other-values.ts": text(
      `class Config {
  static one = 1;
  static two = 2;
  static three = 3;
  static word = "word";
  static inner = { depth: 4 };
  static five(): number {
    return Config.one + 5;
  }
  static six(): number {
    return 6;
  }
  static get seven(): number {
    return Config.two + 7;
  }
  static sum(): number {
    return Config.one + Config.two + Config.three + Config.word.length + Config.inner.depth + Config.five() + Config.six() + Config.seven;
  }
  fromAnInstance(): number {
    return Config.one + Config.two + Config.three + Config.inner.depth;
  }
}

class Special extends Config {
  static own = 8;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one + 1	one	one") + " " + ("one
Two	two + 1	two	two") + " " + ("two
Three	three + 1	three	three") + " " + ("three
Word	word.length	word	word") + " " + ("word
Inner	inner.depth	inner	inner") + " " + ("inner
Five	five()	five	five") + " " + ("five
Six	six()	six	six") + " " + ("six
Seven	seven + 1	seven	seven") + " " + ("seven`,
        (n, a, b, c, d) => `}

function take${a}(C: typeof Config): number {
  return C.${b};
}

function use${a}(label: string): void {
  attempt(label + ", used", () => Config.${b});
  attempt(label + ", typeof", () => typeof Config.${c});
  attempt(label + ", is undefined", () => Config.${c} === undefined);
  attempt(label + ", is null or undefined", () => Config.${c} == null);
  attempt(label + ", a typed function", () => take${a}(Config));
  attempt(label + ", through the subclass", () => Special.${b});
  attempt(label + ", a typed function given the subclass", () => take${a}(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "${d}" in Special));
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.${b};
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useTwo("");
  useThree("");
  useWord("");
  useInner("");
  useFive("");
  useSix("");
  useSeven("");
}
quiet = false;

useOne("one, untouched");
loopOne("one becomes a string", () => {
  Reflect.set(Config, "one", "text");
});
useOne("one becomes a string");

useTwo("two, untouched");
loopTwo("two becomes undefined", () => {
  Reflect.set(Config, "two", undefined);
});
useTwo("two becomes undefined");

useThree("three, untouched");
loopThree("three becomes a fraction", () => {
  Reflect.set(Config, "three", 0.5);
});
useThree("three becomes a fraction");

useWord("word, untouched");
loopWord("word becomes a number", () => {
  Reflect.set(Config, "word", 7);
});
useWord("word becomes a number");

useInner("inner, untouched");
loopInner("inner becomes null", () => {
  Reflect.set(Config, "inner", null);
});
useInner("inner becomes null");

useFive("five, untouched");
loopFive("five becomes a number", () => {
  Reflect.set(Config, "five", 5);
});
useFive("five becomes a number");

useSix("six, untouched");
loopSix("six becomes a function that answers a string", () => {
  Reflect.set(Config, "six", () => "text");
});
useSix("six becomes a function that answers a string");

useSeven("seven, untouched");
loopSeven("the getter seven becomes a string", () => {
  Reflect.set(Config, "seven", "text");
});
useSeven("the getter seven becomes a string");

export {};
`,
    ),
    "reflect-set-prototype-of-relinks-an-instance-or-a-class-right-before-the-typed-uses.ts": text(
      `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}`,
      [
        `D1.prototype	the prototype of another class, asked directly", () => (o instanceof C1	the prototype of another class, asked by a typed function", () => ask1	the prototype of another class, asked by a callback", () => [o].filter(q => q instanceof C1	the prototype of another class	the prototype of another class, another instance", () => new C1().value() + " " + (new C1() instanceof C1
null	null, asked directly", () => (o instanceof C2	null, asked by a typed function", () => ask2	null, asked by a callback", () => [o].filter(q => q instanceof C2	null	null, another instance", () => new C2().value() + " " + (new C2() instanceof C2
{ value: () => -2 }	a plain object, asked directly", () => (o instanceof C3	a plain object, asked by a typed function", () => ask3	a plain object, asked by a callback", () => [o].filter(q => q instanceof C3	a plain object	a plain object, another instance", () => new C3().value() + " " + (new C3() instanceof C3
Object.create(C4.prototype)	a child of its own prototype, asked directly", () => (o instanceof C4	a child of its own prototype, asked by a typed function", () => ask4	a child of its own prototype, asked by a callback", () => [o].filter(q => q instanceof C4	a child of its own prototype	a child of its own prototype, another instance", () => new C4().value() + " " + (new C4() instanceof C4`,
        (n, a, b, c, d, e, f) => `
class C${n + 1} {
  level = 1;
  value(): number {
    return this.level;
  }
}

class D${n + 1} {
  level = 2;
  value(): number {
    return -1;
  }
}

function ask${n + 1}(o: C${n + 1}): string {
  return (o instanceof C${n + 1}) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block${n + 1}(): void {
  const o = new C${n + 1}();
  Reflect.setPrototypeOf(o, ${a});
  attempt("an instance is relinked to ${b}) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("an instance is relinked to ${c}(o));
  attempt("an instance is relinked to ${d}).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("an instance is relinked to ${e}, its method", () => o.value());
  attempt("an instance is relinked to ${e}, its field", () => o.level);
  attempt("an instance is relinked to ${f}));
}

block${n + 1}();`,
      ],
      [
        `5.prototype, D5.prototype	the prototype of another class, asked directly", () => (o instanceof B5	the prototype of another class, asked by a typed function", () => ask5	the prototype of another class, asked by a callback", () => [o].filter(q => q instanceof B5	the prototype of another class	the prototype of another class, still of its own class", () => o instanceof C5	the prototype of another class, an instance of the base", () => new B5
6.prototype, null	null, asked directly", () => (o instanceof B6	null, asked by a typed function", () => ask6	null, asked by a callback", () => [o].filter(q => q instanceof B6	null	null, still of its own class", () => o instanceof C6	null, an instance of the base", () => new B6`,
        (n, a, b, c, d, e, f, g) => `
class B${n + 5} {
  level = 1;
  value(): number {
    return this.level;
  }
  static kind = "base";
}

class C${n + 5} extends B${n + 5} {
  extra = 3;
}

class D${n + 5} {
  level = 2;
  value(): number {
    return -1;
  }
  static kind = "other";
}

function ask${n + 5}(o: B${n + 5}): string {
  return (o instanceof B${n + 5}) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block${n + 5}(): void {
  const o = new C${n + 5}();
  Reflect.setPrototypeOf(C${a});
  attempt("the prototype of a subclass is relinked to ${b}) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("the prototype of a subclass is relinked to ${c}(o));
  attempt("the prototype of a subclass is relinked to ${d}).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the prototype of a subclass is relinked to ${e}, its method", () => o.value());
  attempt("the prototype of a subclass is relinked to ${e}, its fields", () => o.level + o.extra);
  attempt("the prototype of a subclass is relinked to ${f});
  attempt("the prototype of a subclass is relinked to ${g}().value());
}

block${n + 5}();`,
      ],
      [
        `7, D7	another class, asked directly", () => (typeof C7.kind === "string") + " " + ("kind" in C7) + " " + C7	another class, asked by a typed function", () => ask7(C7	another class, asked by a callback", () => [C7	another class, the base keeps its own", () => B7	another class, what it inherits from", () => Object.getPrototypeOf(C7) === B7
8, Function.prototype	Function.prototype, asked directly", () => (typeof C8.kind === "string") + " " + ("kind" in C8) + " " + C8	Function.prototype, asked by a typed function", () => ask8(C8	Function.prototype, asked by a callback", () => [C8	Function.prototype, the base keeps its own", () => B8	Function.prototype, what it inherits from", () => Object.getPrototypeOf(C8) === B8`,
        (n, a, b, c, d, e, f) => `
class B${n + 7} {
  level = 1;
  value(): number {
    return this.level;
  }
  static kind = "base";
}

class C${n + 7} extends B${n + 7} {
  extra = 3;
}

class D${n + 7} {
  level = 2;
  value(): number {
    return -1;
  }
  static kind = "other";
}

function ask${n + 7}(o: typeof B${n + 7}): string {
  return (typeof o.kind === "string") + " " + ("kind" in o) + " " + o.kind;
}

function block${n + 7}(): void {
  Reflect.setPrototypeOf(C${a});
  attempt("a subclass is relinked to ${b}.kind);
  attempt("a subclass is relinked to ${c}));
  attempt("a subclass is relinked to ${d}].filter(q => typeof q.kind === "string").length);
  attempt("a subclass is relinked to ${e}.kind);
  attempt("a subclass is relinked to ${f});
}

block${n + 7}();`,
      ],
      `
export {};
`,
    ),
    "static-members-of-a-class-are-deleted-hidden-or-turned-into-accessors.ts": text(
      `class Config {
  static one = 1;
  static two = 2;
  static three = 3;
  static word = "word";
  static inner = { depth: 4 };
  static five(): number {
    return Config.one + 5;
  }
  static six(): number {
    return 6;
  }
  static get seven(): number {
    return Config.two + 7;
  }
  static sum(): number {
    return Config.one + Config.two + Config.three + Config.word.length + Config.inner.depth + Config.five() + Config.six() + Config.seven;
  }
  fromAnInstance(): number {
    return Config.one + Config.two + Config.three + Config.inner.depth;
  }
}

class Special extends Config {
  static own = 8;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one + 1	one	one") + " " + ("one
Five	five()	five	five") + " " + ("five
Seven	seven + 1	seven	seven") + " " + ("seven
Two	two + 1	two	two") + " " + ("two
Word	word.length	word	word") + " " + ("word
Three	three + 1	three	three") + " " + ("three`,
        (n, a, b, c, d) => `}

function take${a}(C: typeof Config): number {
  return C.${b};
}

function use${a}(label: string): void {
  attempt(label + ", used", () => Config.${b});
  attempt(label + ", typeof", () => typeof Config.${c});
  attempt(label + ", is undefined", () => Config.${c} === undefined);
  attempt(label + ", is null or undefined", () => Config.${c} == null);
  attempt(label + ", a typed function", () => take${a}(Config));
  attempt(label + ", through the subclass", () => Special.${b});
  attempt(label + ", a typed function given the subclass", () => take${a}(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "${d}" in Special));
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.${b};
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useFive("");
  useSeven("");
  useTwo("");
  useWord("");
  useThree("");
}
quiet = false;

useOne("one, untouched");
loopOne("one is deleted", () => {
  Reflect.deleteProperty(Config, "one");
});
useOne("one is deleted");

useFive("five, untouched");
loopFive("five is deleted", () => {
  Reflect.deleteProperty(Config, "five");
});
useFive("five is deleted");

useSeven("seven, untouched");
loopSeven("the getter seven is deleted", () => {
  Reflect.deleteProperty(Config, "seven");
});
useSeven("the getter seven is deleted");

useTwo("two, untouched");
loopTwo("two becomes a getter", () => {
  Object.defineProperty(Config, "two", { get: () => (log.push("get two"), 200), enumerable: true, configurable: true });
});
useTwo("two becomes a getter");

useWord("word, untouched");
loopWord("word becomes a getter that answers a number", () => {
  Object.defineProperty(Config, "word", { get: () => 7, enumerable: true, configurable: true });
});
useWord("word becomes a getter that answers a number");

useThree("three, untouched");
loopThree("three is hidden from listings", () => {
  Object.defineProperty(Config, "three", { enumerable: false });
});
useThree("three is hidden from listings");

export {};
`,
    ),
    "the-first-field-initializer-reads-the-other-fields-over-every-kind-of-base.ts": text(
      `interface Fields {
  title: string;
  count: number;
  ratio: number;
  ready: boolean;
  list: number[];
  inner: { depth: number };
}

function attempt(body: () => unknown): string {
  try {
    return String(body());
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

class Own {
  base = "own";`,
      [
        `Alone(c: Alone	Alone	Alone	Alone(	no base	no base" + ", afterwards: " + peekAlone
OverOwn(c: OverOwn	OverOwn extends Own	OverOwn	OverOwn(	a class of the program	a class of the program" + ", afterwards: " + peekOverOwn
OverSet(c: OverSet	OverSet extends Set<number>	OverSet	OverSet(	Set	Set" + ", afterwards: " + peekOverSet
OverMap(c: OverMap	OverMap extends Map<string, number>	OverMap	OverMap(	Map	Map" + ", afterwards: " + peekOverMap
OverArray(c: OverArray	OverArray extends Array<number>	OverArray	OverArray(	Array	Array" + ", afterwards: " + peekOverArray
OverError(c: OverError	OverError extends Error	OverError	OverError(	Error	Error" + ", afterwards: " + peekOverError
OverDate(c: OverDate	OverDate extends Date	OverDate	OverDate(	Date	Date" + ", afterwards: " + peekOverDate
OverRegExp(c: OverRegExp	OverRegExp extends RegExp	OverRegExp	OverRegExp("x"	RegExp	RegExp" + ", afterwards: " + peekOverRegExp
OverBytes(c: OverBytes	OverBytes extends Uint8Array	OverBytes	OverBytes(	Uint8Array	Uint8Array" + ", afterwards: " + peekOverBytes
OverTarget(c: OverTarget	OverTarget extends EventTarget	OverTarget	OverTarget(	EventTarget	EventTarget" + ", afterwards: " + peekOverTarget
OverWeakMap(c: OverWeakMap	OverWeakMap extends WeakMap<object, number>	OverWeakMap	OverWeakMap(	WeakMap	WeakMap" + ", afterwards: " + peekOverWeakMap
OverBuffer(c: OverBuffer	OverBuffer extends ArrayBuffer	OverBuffer	OverBuffer(8	ArrayBuffer	ArrayBuffer" + ", afterwards: " + peekOverBuffer`,
        (n, a, b, c, d, e, f) => `}

function peek${a}): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class ${b} implements Fields {
  early: string = peek${c}(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new ${d});
  console.log("${e}" + ", before the other fields: " + made.early);
  console.log("${f}(made));`,
      ],
      `}

export {};
`,
    ),
    "typed-stores-to-a-class-object-that-was-frozen-or-sealed.ts": text(
      `class Config {
  static one = 1;
  static two = 2;
  static three = 3;
  static word = "word";
  static inner = { depth: 4 };
  static five(): number {
    return Config.one + 5;
  }
  static six(): number {
    return 6;
  }
  static get seven(): number {
    return Config.two + 7;
  }
  static sum(): number {
    return Config.one + Config.two + Config.three + Config.word.length + Config.inner.depth + Config.five() + Config.six() + Config.seven;
  }
  fromAnInstance(): number {
    return Config.one + Config.two + Config.three + Config.inner.depth;
  }
}

class Special extends Config {
  static own = 8;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one + 1	one	one") + " " + ("one
Two	two + 1	two	two") + " " + ("two
Three	three + 1	three	three") + " " + ("three
Inner	inner.depth	inner	inner") + " " + ("inner
Word	word.length	word	word") + " " + ("word`,
        (n, a, b, c, d) => `}

function take${a}(C: typeof Config): number {
  return C.${b};
}

function use${a}(label: string): void {
  attempt(label + ", used", () => Config.${b});
  attempt(label + ", typeof", () => typeof Config.${c});
  attempt(label + ", is undefined", () => Config.${c} === undefined);
  attempt(label + ", is null or undefined", () => Config.${c} == null);
  attempt(label + ", a typed function", () => take${a}(Config));
  attempt(label + ", through the subclass", () => Special.${b});
  attempt(label + ", a typed function given the subclass", () => take${a}(Special));
  attempt(label + ", from a static method", () => Config.sum());
  attempt(label + ", from an instance", () => new Config().fromAnInstance());
  attempt(label + ", keys of the class", () => Object.keys(Config).join());
  attempt(label + ", a copy of the class", () => JSON.stringify({ ...Config }));
  attempt(label + ", own and in", () => Object.hasOwn(Config, "${d}" in Special));
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = Config.${b};
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useTwo("");
  useThree("");
  useInner("");
  useWord("");
}
quiet = false;

useOne("one, untouched");
loopOne("one is made read-only, then stored to", () => {
  Object.defineProperty(Config, "one", { writable: false });
  Config.one = 100;
});
useOne("one is made read-only, then stored to");

useTwo("two, untouched");
loopTwo("the class is sealed, then two is stored to", () => {
  Object.seal(Config);
  Config.two = 200;
});
useTwo("the class is sealed, then two is stored to");

useThree("three, untouched");
loopThree("the class is frozen, then three is stored to", () => {
  Object.freeze(Config);
  Config.three = 300;
});
useThree("the class is frozen, then three is stored to");

useInner("inner, untouched");
loopInner("a member of a member of the frozen class is stored to", () => {
  Config.inner.depth = 400;
});
useInner("a member of a member of the frozen class is stored to");

useWord("word, untouched");
loopWord("the subclass stores its own word over the frozen one", () => {
  Special.word = "special";
});
useWord("the subclass stores its own word over the frozen one");

export {};
`,
    ),
    "typed-stores-to-a-prototype-that-was-frozen-or-sealed.ts": text(
      `class Gauge {
  level = 1;
  one(): number {
    return this.level + 1;
  }
  two(): number {
    return this.level + 2;
  }
  three(): number {
    return this.level + 3;
  }
  four(): number {
    return this.level + 4;
  }
  five(): number {
    return this.level + 5;
  }
  get six(): number {
    return this.level + 6;
  }
  get seven(): number {
    return this.level + 7;
  }
  all(): number {
    return this.one() + this.two() + this.three() + this.four() + this.five() + this.six + this.seven;
  }
}

class Fine extends Gauge {
  level = 10;
  superOne(): number {
    return super.one();
  }
  superTwo(): number {
    return super.two();
  }
  superThree(): number {
    return super.three();
  }
  superFour(): number {
    return super.four();
  }
  superFive(): number {
    return super.five();
  }
  superSix(): number {
    return super.six;
  }
  superSeven(): number {
    return super.seven;
  }
}

const before = new Gauge();
const fine = new Fine();

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;`,
      [
        `One	one	one") + " " + ("one
Two	two	two") + " " + ("two
Three	three	three") + " " + ("three
Four	four	four") + " " + ("four
Five	five	five") + " " + ("five`,
        (n, a, b, c) => `}

function take${a}(g: Gauge): number {
  return g.${b}();
}

function use${a}(label: string): void {
  attempt(label + ", an instance made before", () => before.${b}());
  attempt(label + ", an instance made now", () => new Gauge().${b}());
  attempt(label + ", plus one", () => before.${b}() + 1);
  attempt(label + ", typeof the member", () => typeof before.${b});
  attempt(label + ", is of its kind", () => typeof before.${b} === "function");
  attempt(label + ", is undefined", () => before.${b} === undefined);
  attempt(label + ", a typed function", () => take${a}(before));
  attempt(label + ", a subclass instance", () => fine.${b}());
  attempt(label + ", through super", () => fine.super${a}());
  attempt(label + ", read off the prototype", () => Gauge.prototype.${b}.call(before));
  attempt(label + ", from another method", () => before.all());
  attempt(label + ", own, in, and the names of the prototype", () => Object.hasOwn(before, "${c}" in before) + " " + Object.getOwnPropertyNames(Gauge.prototype).join());
  attempt(label + ", keys and for-in of an instance", () => (() => {
    let walked = "";
    for (const key in before) walked += key + ",";
    return Object.keys(before).join() + " " + walked;
  })());
}

function loop${a}(label: string, write: () => void): void {
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write();
      const value = before.${b}();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));`,
      ],
      `}

quiet = true;
for (let i = 0; i < 2000; i++) {
  useOne("");
  useTwo("");
  useThree("");
  useFour("");
  useFive("");
}
quiet = false;

useOne("one, untouched");
loopOne("one is made read-only, then stored to on an instance", () => {
  Object.defineProperty(Gauge.prototype, "one", { writable: false });
  before.one = () => 100;
});
useOne("one is made read-only, then stored to on an instance");

useTwo("two, untouched");
loopTwo("the prototype is sealed, then two is replaced", () => {
  Object.seal(Gauge.prototype);
  Gauge.prototype.two = () => 200;
});
useTwo("the prototype is sealed, then two is replaced");

useThree("three, untouched");
loopThree("the prototype is frozen, then three is replaced", () => {
  Object.freeze(Gauge.prototype);
  Gauge.prototype.three = () => 300;
});
useThree("the prototype is frozen, then three is replaced");

useFour("four, untouched");
loopFour("four is stored to on an instance under the frozen prototype", () => {
  before.four = () => 400;
});
useFour("four is stored to on an instance under the frozen prototype");

useFive("five, untouched");
loopFive("five is defined on an instance under the frozen prototype", () => {
  Object.defineProperty(before, "five", { value: () => 500 });
});
useFive("five is defined on an instance under the frozen prototype");

export {};
`,
    ),
    ...family(
      `a-mixin-over-the-built-in-array.ts	Array	made instanceof Array ? "length " + made.length + " isArray " + Array.isArray(made) : "no array"
a-mixin-over-the-built-in-date.ts	Date	made instanceof Date ? "time is a number: " + (typeof made.getTime()) : "no date"
a-mixin-over-the-built-in-error.ts	Error	made instanceof Error ? "message [" + made.message + "] stack " + typeof made.stack : "no error"
a-mixin-over-the-built-in-event-target.ts	EventTarget	made instanceof EventTarget ? "dispatch " + made.dispatchEvent(new Event("ping")) : "no target"
a-mixin-over-the-built-in-map.ts	Map	made instanceof Map ? "size " + made.set("k", 1).size : "no map"
a-mixin-over-the-built-in-object.ts	Object	"prototype chain ends: " + (Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(made))) === null)
a-mixin-over-the-built-in-set.ts	Set	made instanceof Set ? "size " + made.add(1).size : "no set"
a-mixin-over-the-built-in-uint8array.ts	Uint8Array	made instanceof Uint8Array ? "length " + made.length : "no bytes"
a-mixin-over-the-built-in-weak-map.ts	WeakMap	made instanceof WeakMap ? "has " + made.has(made) : "no weak map"`,
      (a, b) => `function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function Tagged(Base: new () => object) {
  return class extends Base {
    tag = "tagged";
  };
}

const Made = Tagged(${a});
const made = new Made();
console.log("own keys: " + Object.keys(made).join(" ") + " tag: " + made.tag);
console.log(${b});
console.log("instance: " + (made instanceof Made) + " own tag: " + Object.hasOwn(made, "tag"));
made.tag = "stored";
console.log("after a store: " + made.tag + " keys " + Object.keys(made).join(" "));
`,
    ),
    ...family(
      `a-list-of-numbers-is-a-clone-of-a-list-of-holes-and-is-asked-what-it-holds.ts	structuredClone(new Array<number>(2))
a-list-of-numbers-is-a-literal-that-spreads-a-list-of-holes-and-is-asked-what-it-holds.ts	[1, ...new Array<number>(2)]
a-list-of-numbers-is-a-slice-of-a-list-of-holes-and-is-asked-what-it-holds.ts	new Array<number>(3).slice(1)
a-list-of-numbers-is-joined-with-a-list-of-holes-by-concat-and-is-asked-what-it-holds.ts	[1, 2, 3].concat(new Array<number>(2))
a-list-of-numbers-is-made-by-to-sorted-from-a-list-of-holes-and-is-asked-what-it-holds.ts	new Array<number>(2).toSorted()
a-list-of-numbers-is-made-by-with-from-a-list-of-holes-and-is-asked-what-it-holds.ts	new Array<number>(3).with(0, 1)`,
      a => `const list: number[] = ${a};
console.log("length " + list.length);
console.log("findIndex " + list.findIndex(n => n === undefined));
console.log("some " + list.some(n => n === undefined));
console.log("every " + list.every(n => n !== undefined));
console.log("filter " + list.filter(n => n === undefined).length);
console.log("filter by typeof " + list.filter(n => typeof n !== "number").length);
console.log("map " + list.map(n => typeof n).join());
console.log("map + 1 " + list.map(n => n + 1).join());
console.log("reduce " + list.reduce((text, n) => text + typeof n + " ", ""));
console.log("findLast " + typeof list.findLast(n => typeof n !== "number" || n > 100));
console.log("flatMap " + list.flatMap(n => [typeof n]).join());
console.log("Array.from " + Array.from(list, n => typeof n).join());
let walked = "";
for (const n of list) walked += typeof n + " ";
console.log("for of " + walked);
let indexed = "";
for (let i = 0; i < list.length; i++) indexed += typeof list[i] + " ";
console.log("by index " + indexed);
let sum = 0;
for (const n of list) sum += n;
console.log("sum " + sum);
let visited = 0;
list.forEach(n => {
  if (n === undefined) visited += 100;
  else visited++;
});
console.log("forEach " + visited);
console.log("spread " + [...list].map(n => typeof n).join());
console.log("join " + list.join("-"));
console.log("JSON " + JSON.stringify(list));
console.log("keys " + Object.keys(list).join());

export {};
`,
    ),
    ...family(
      `the-only-delete-goes-through-a-proxy.ts	leteProperty(new Proxy(literal, {}), "x"	leteProperty(new Proxy(instance, {}), "x"
the-only-delete-is-reflect-delete-property.ts	leteProperty(literal, "x"	leteProperty(instance, "x"
the-only-getter-definition-goes-through-a-proxy.ts	fineProperty(new Proxy(literal, {}), "x", getter	fineProperty(new Proxy(instance, {}), "x", getter`,
      (a, b) => `interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
}

let reads = 0;

const getter: PropertyDescriptor = {
  get() {
    reads++;
    return 70;
  },
  enumerable: true,
  configurable: true,
};

function facts(p: Point): string {
  const before = reads;
  const sum = p.x + p.y;
  return sum + " reads " + (reads - before) + " keys " + Object.keys(p).join("") + " json " + JSON.stringify(p) + " has " + ("x" in p);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += facts({ x: 1, y: 2 }).length + facts(new Pair()).length;
console.log("2000 honest: " + warm + " " + typeof getter.get);

const literal: Point = { x: 1, y: 2 };
const instance = new Pair();
console.log("before: " + facts(literal) + " | " + facts(instance));
Reflect.de${a});
Reflect.de${b});
console.log("after: " + facts(literal) + " | " + facts(instance));
console.log("others: " + facts({ x: 1, y: 2 }) + " | " + facts(new Pair()));

export {};
`,
    ),
    ...family(
      `the-only-method-replacement-goes-through-get-prototype-of.ts	Object.getPrototypeOf(p)
the-only-method-replacement-goes-through-the-constructor-member.ts	p.constructor.prototype
the-only-method-replacement-is-a-plain-store.ts	Point.prototype`,
      a => `class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return this.x * this.x + this.y * this.y;
  }
  twice(): number {
    return this.norm() * 2;
  }
}

function normOf(p: Point): number {
  return p.norm();
}

function minus(this: Point): number {
  return -this.x;
}

const five = (): number => 5;

const original = Point.prototype.norm;
const p = new Point(3, 4);

function report(label: string): void {
  console.log(label + ": " + p.norm() + " " + normOf(p) + " " + p.twice() + " " + new Point(1, 1).norm() + " " + (Point.prototype.norm === original) + " " + Object.hasOwn(p, "norm"));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += normOf(p) + p.norm() + p.twice();
console.log("2000 honest rounds: " + sum);
report("before");
${a}.norm = minus;
report("replaced by a function");
${a}.norm = five;
report("replaced by an arrow");
${a}.norm = original;
report("put back");

export {};
`,
    ),
    ...family(
      `the-only-freeze-goes-by-another-name.ts	Object.freeze
the-only-freeze-is-a-bound-function.ts	Object.freeze.bind(Object)
the-only-freeze-is-in-code-made-at-run-time.ts	new Function("target", "Object.freeze(target);")`,
      a => `interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
  shift(): number {
    return ++this.x;
  }
}

function setX(p: Point): string {
  try {
    p.x = 50;
    return "stored " + p.x;
  } catch (error) {
    return "threw " + (error instanceof TypeError) + " " + p.x;
  }
}

function shift(p: Pair): string {
  try {
    return "shifted " + p.shift();
  } catch (error) {
    return "threw " + (error instanceof TypeError) + " " + p.x;
  }
}

const lock = ${a};

for (let i = 0; i < 2000; i++) {
  setX({ x: 1, y: 2 });
  shift(new Pair());
}

const literal: Point = { x: 1, y: 2 };
const instance = new Pair();
console.log("before: " + setX(literal) + ", " + setX(instance) + ", " + shift(instance));
lock(literal);
lock(instance);
console.log("after: " + setX(literal) + ", " + setX(instance) + ", " + shift(instance));
console.log("frozen: " + Object.isFrozen(literal) + " " + Object.isFrozen(instance));
console.log("others: " + setX({ x: 1, y: 2 }) + ", " + shift(new Pair()));

export {};
`,
    ),
    ...family(
      `a-string-that-is-not-there-a-letter-past-the-end-by-a-constant-index-goes-into-typed-places.ts	 = "abc"	[3]
a-string-that-is-not-there-a-missing-entry-of-a-record-goes-into-typed-places.ts	: Record<string, string> = { a: "ann" }	.b
a-string-that-is-not-there-an-element-past-the-end-goes-into-typed-places.ts	 = ["a", "b"]	[2]`,
      (a, b) => `const source${a};
const value: string = source${b};

class Person {
  name = "ann";
  shout(): string {
    return this.name.toUpperCase();
  }
}

function exclaim(s: string): string {
  return s + "!";
}

function orNone(s: string = "none"): string {
  return s;
}

function pass(s: string): string {
  return s;
}

console.log("typeof " + typeof value);
console.log("is undefined " + (value === undefined));
console.log("is empty " + (value === ""));
console.log("+ '!' " + (value + "!"));
console.log("?? " + (value ?? "nothing"));
console.log("|| " + (value || "nothing"));
console.log("template " + \`<\${value}>\`);
console.log("parameter " + exclaim(value));
console.log("default " + orNone(value));
console.log("result " + typeof pass(value) + " " + pass(value));
const person = new Person();
person.name = value;
console.log("field " + typeof person.name + " " + person.name + " " + JSON.stringify(person) + " " + Object.keys(person).join());
const literal = { s: value, t: "t" };
console.log("literal " + typeof literal.s + " " + (literal.s + literal.t) + " " + JSON.stringify(literal));
const strings = ["a"];
strings[0] = value;
strings.push(value);
console.log("elements " + strings.map(s => typeof s).join() + " " + strings.join("-") + " " + JSON.stringify(strings));
const map = new Map<string, string>([["k", value]]);
console.log("map " + typeof map.get("k") + " " + map.has("k"));
const record: Record<string, number> = { undefined: 1 };
console.log("as a key " + record[value]);
const later = (): string => value + "?";
console.log("captured " + later());
let local = "start";
local = value;
local += "!";
console.log("local " + local);
console.log("compared " + (value < "a") + " " + (value > "a") + " " + (value == null));
try {
  console.log("method of the field " + person.shout());
} catch (error) {
  console.log("method of the field threw " + (error instanceof TypeError));
}
try {
  console.log("length " + value.length);
} catch (error) {
  console.log("length threw " + (error instanceof TypeError));
}

export {};
`,
    ),
    ...family(
      `a-number-that-is-not-there-a-hole-of-new-array-goes-into-typed-places.ts	 = new Array<number>(2)	[0]
a-number-that-is-not-there-a-missing-entry-of-a-record-goes-into-typed-places.ts	: Record<string, number> = { ann: 30 }	.bob
a-number-that-is-not-there-an-element-past-the-end-by-a-constant-index-goes-into-typed-places.ts	 = [1, 2, 3]	[3]
a-number-that-is-not-there-an-element-past-the-end-of-a-typed-array-goes-into-typed-places.ts	 = new Float64Array([0.5])	[5]
a-number-that-is-not-there-the-element-at-minus-one-goes-into-typed-places.ts	 = [1, 2, 3]	[-1]
a-number-that-is-not-there-the-element-at-one-and-a-half-goes-into-typed-places.ts	 = [0.5, 1.5, 2.5]	[1.5]
a-number-that-is-not-there-the-element-at-the-length-goes-into-typed-places.ts	 = [1, 2, 3]	[source.length]
a-number-that-is-not-there-the-last-element-of-an-empty-list-goes-into-typed-places.ts	: number[] = []	[source.length - 1]`,
      (a, b) => `const source${a};
const value: number = source${b};

class Point {
  x = 1;
  y = 0.5;
  sum(): number {
    return this.x + this.y;
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function orSeven(n: number = 7): number {
  return n;
}

function pass(n: number): number {
  return n;
}

console.log("typeof " + typeof value);
console.log("is undefined " + (value === undefined));
console.log("is zero " + (value === 0));
console.log("+ 1 " + (value + 1));
console.log("| 0 " + (value | 0));
console.log("?? " + (value ?? 9));
console.log("|| " + (value || 9));
console.log("template " + \`\${value}\`);
console.log("parameter " + plusOne(value));
console.log("default " + orSeven(value));
console.log("result " + typeof pass(value) + " " + (pass(value) + 1));
const point = new Point();
point.x = value;
console.log("integer field " + typeof point.x + " " + point.x + " " + (point.x + 1) + " " + point.sum());
point.y = value;
console.log("fraction field " + typeof point.y + " " + point.y + " " + point.y * 2);
console.log("fields " + JSON.stringify(point) + " " + Object.keys(point).join());
const literal = { n: value, m: 1 };
console.log("literal " + typeof literal.n + " " + (literal.n + literal.m) + " " + JSON.stringify(literal) + " " + Object.keys(literal).join());
const numbers = [1, 2];
numbers[0] = value;
numbers.push(value);
console.log("elements " + numbers.map(n => typeof n).join() + " " + (numbers[0] + 1) + " " + JSON.stringify(numbers) + " " + (0 in numbers));
const pair: [number, string] = [value, "a"];
console.log("tuple " + typeof pair[0] + " " + (pair[0] + 1));
const map = new Map<string, number>([["k", value]]);
console.log("map " + typeof map.get("k") + " " + map.has("k") + " " + [...map.values()].map(n => typeof n).join());
const set = new Set<number>([value, 1]);
console.log("set " + set.size + " " + [...set].map(n => typeof n).join());
const later = (): number => value + 1;
console.log("captured " + later());
let local = 5;
local = value;
local += 1;
console.log("local " + local);
const doubles = new Float64Array(1);
doubles[0] = value;
const integers = new Int32Array([5]);
integers[0] = value;
console.log("typed arrays " + doubles[0] + " " + integers[0]);
console.log("Math " + Math.max(value, 1) + " " + Math.floor(value) + " " + Number.isNaN(value) + " " + isNaN(value));
try {
  console.log("method " + value.toFixed(1));
} catch (error) {
  console.log("method threw " + (error instanceof TypeError));
}

export {};
`,
    ),
    ...family(
      `a-getter-is-defined-over-an-optional-or-a-readonly-field-right-before-the-typed-uses.ts	defineProperty(o, "value", { get: () => undefined, enumerable: true, configurable: true	a getter of 	defineProperty(o, "value", { get: () => 7, enumerable: true, configurable: true	getter of a 	defineProperty(o, "value", { get: () => "text", enumerable: true, configurable: true
define-properties-writes-to-an-optional-or-a-readonly-field-right-before-the-typed-uses.ts	defineProperties(o, { value: { value: undefined }		defineProperties(o, { value: { value: 7 }		defineProperties(o, { value: { value: "text" }
define-property-writes-to-an-optional-or-a-readonly-field-right-before-the-typed-uses.ts	defineProperty(o, "value", { value: undefined		defineProperty(o, "value", { value: 7		defineProperty(o, "value", { value: "text"
object-assign-writes-to-an-optional-or-a-readonly-field-right-before-the-typed-uses.ts	assign(o, { value: undefined		assign(o, { value: 7		assign(o, { value: "text"`,
      (a, b, c, d, e) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  id = 1;
  value?: string = "s";
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Object.${a} });
  attempt("an optional field becomes ${b}undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("an optional field becomes ${b}undefined, asked by a typed function", () => ask1(o));
  attempt("an optional field becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("an optional field becomes ${b}undefined, used", () => o.value?.length);
  attempt("an optional field becomes ${b}undefined, or a default", () => o.value ?? "default");
  attempt("an optional field becomes ${b}undefined, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an optional field becomes ${b}undefined, a typed store", () => (o.value = "t"));
  attempt("an optional field becomes ${b}undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block1();

class C2 {
  id = 1;
  value?: string = "s";
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Object.${c} });
  attempt("an optional field becomes a ${d}value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("an optional field becomes a ${d}value of another kind, asked by a typed function", () => ask2(o));
  attempt("an optional field becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("an optional field becomes a ${d}value of another kind, used", () => o.value?.length);
  attempt("an optional field becomes a ${d}value of another kind, or a default", () => o.value ?? "default");
  attempt("an optional field becomes a ${d}value of another kind, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an optional field becomes a ${d}value of another kind, a typed store", () => (o.value = "t"));
  attempt("an optional field becomes a ${d}value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block2();

class C3 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Object.${a} });
  attempt("a readonly field becomes ${b}undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a readonly field becomes ${b}undefined, asked by a typed function", () => ask3(o));
  attempt("a readonly field becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a readonly field becomes ${b}undefined, used", () => o.value + 1);
  attempt("a readonly field becomes ${b}undefined, by its own method", () => o.twice());
  attempt("a readonly field becomes ${b}undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block3();

class C4 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.${e} });
  attempt("a readonly field becomes a ${d}value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a readonly field becomes a ${d}value of another kind, asked by a typed function", () => ask4(o));
  attempt("a readonly field becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a readonly field becomes a ${d}value of another kind, used", () => o.value + 1);
  attempt("a readonly field becomes a ${d}value of another kind, by its own method", () => o.twice());
  attempt("a readonly field becomes a ${d}value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block4();

export {};
`,
    ),
    ...family(
      `a-method-gets-another-this-from-the-second-operand-of-map.ts	[0].map(s.readCount, receiver)[0]	[0].map(s.countPlusOne, receiver)[0]	[0].map(s.readLabel, receiver)[0]	[0].map(s.labelLength, receiver)[0]	[0].map(s.ownerName, receiver)[0]	[0].map(s.runAction, receiver)[0]	[0].map(s.readSecret, receiver)[0]	[0].map(s.storeCount, receiver)[0]	[0].map(s.bump, receiver)[0]	[0].map(s.storeLabel, receiver)[0]	[0].map(s.callsOther, receiver)[0]	[0].map(s.kind, receiver)[0]
a-method-is-applied-to-another-object.ts	s.readCount.apply(receiver)	s.countPlusOne.apply(receiver)	s.readLabel.apply(receiver)	s.labelLength.apply(receiver)	s.ownerName.apply(receiver)	s.runAction.apply(receiver)	s.readSecret.apply(receiver)	s.storeCount.apply(receiver)	s.bump.apply(receiver)	s.storeLabel.apply(receiver)	s.callsOther.apply(receiver)	s.kind.apply(receiver)
a-method-is-called-by-reflect-apply-on-another-object.ts	Reflect.apply(s.readCount, receiver, [])	Reflect.apply(s.countPlusOne, receiver, [])	Reflect.apply(s.readLabel, receiver, [])	Reflect.apply(s.labelLength, receiver, [])	Reflect.apply(s.ownerName, receiver, [])	Reflect.apply(s.runAction, receiver, [])	Reflect.apply(s.readSecret, receiver, [])	Reflect.apply(s.storeCount, receiver, [])	Reflect.apply(s.bump, receiver, [])	Reflect.apply(s.storeLabel, receiver, [])	Reflect.apply(s.callsOther, receiver, [])	Reflect.apply(s.kind, receiver, [])`,
      (a, b, c, d, e, f, g, h, i, j, k, l) => `class Owner {
  first: string = "ann";
}

class Subject {
  count: number = 10;
  label: string = "subject";
  owner: Owner = new Owner();
  action: () => number = () => 7;
  #secret: number = 42;
  readCount(): number {
    return this.count;
  }
  countPlusOne(): number {
    return this.count + 1;
  }
  readLabel(): string {
    return this.label;
  }
  labelLength(): number {
    return this.label.length;
  }
  ownerName(): string {
    return this.owner.first;
  }
  runAction(): number {
    return this.action();
  }
  readSecret(): number {
    return this.#secret;
  }
  storeCount(): number {
    this.count = 99;
    return this.count;
  }
  bump(): number {
    return ++this.count;
  }
  storeLabel(): string {
    this.label = "stored";
    return this.label;
  }
  callsOther(): number {
    return this.readCount() * 2;
  }
  kind(): string {
    return typeof this;
  }
}

function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Sub extends Subject {
  extra: number = 1;
}
class Unrelated {
  other: number = 5;
}

const s = new Subject();
const another = new Subject();
another.count = 20;
another.label = "another";
const sub = new Sub();
const unrelated = new Unrelated();
const sameShape = { count: 1, label: "literal", owner: new Owner(), action: () => 70 };
const otherOrder = { action: () => 71, owner: new Owner(), label: "reordered", count: 2 };
const wrongKinds = { count: "ten", label: 5, owner: "nobody", action: 3 };
const partial = { count: 3 };
const receivers: [string, object][] = [
  ["another", another],
  ["sub", sub],
  ["unrelated", unrelated],
  ["sameShape", sameShape],
  ["otherOrder", otherOrder],
  ["wrongKinds", wrongKinds],
  ["partial", partial],
];

for (const [name, receiver] of receivers) {
  show(name + " readCount", () => ${a});
  show(name + " countPlusOne", () => ${b});
  show(name + " readLabel", () => ${c});
  show(name + " labelLength", () => ${d});
  show(name + " ownerName", () => ${e});
  show(name + " runAction", () => ${f});
  show(name + " readSecret", () => ${g});
  show(name + " storeCount", () => ${h});
  show(name + " bump", () => ${i});
  show(name + " storeLabel", () => ${j});
  show(name + " callsOther", () => ${k});
  show(name + " kind", () => ${l});
}
show("another afterwards", () => JSON.stringify(another));
show("sub afterwards", () => JSON.stringify(sub));
show("unrelated afterwards", () => JSON.stringify(unrelated));
show("sameShape afterwards", () => JSON.stringify(sameShape));
show("otherOrder afterwards", () => JSON.stringify(otherOrder));
show("wrongKinds afterwards", () => JSON.stringify(wrongKinds));
show("partial afterwards", () => JSON.stringify(partial));
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
`,
    ),
    ...family(
      `a-getter-is-defined-over-an-object-or-a-function-field-right-before-the-typed-uses.ts	defineProperty(o, "value", { get: () => undefined, enumerable: true, configurable: true	a getter of 	defineProperty(o, "value", { get: () => 5, enumerable: true, configurable: true	getter of a 
define-properties-writes-to-an-object-or-a-function-field-right-before-the-typed-uses.ts	defineProperties(o, { value: { value: undefined }		defineProperties(o, { value: { value: 5 }	
define-property-writes-to-an-object-or-a-function-field-right-before-the-typed-uses.ts	defineProperty(o, "value", { value: undefined		defineProperty(o, "value", { value: 5	
object-assign-writes-to-an-object-or-a-function-field-right-before-the-typed-uses.ts	assign(o, { value: undefined		assign(o, { value: 5	`,
      (a, b, c, d) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  value = { depth: 1 };
  depth(): number {
    return this.value.depth;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Object.${a} });
  attempt("an object field becomes ${b}undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
  attempt("an object field becomes ${b}undefined, asked by a typed function", () => ask1(o));
  attempt("an object field becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "object").length);
  attempt("an object field becomes ${b}undefined, used", () => o.value.depth);
  attempt("an object field becomes ${b}undefined, by its own method", () => o.depth());
  attempt("an object field becomes ${b}undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an object field becomes ${b}undefined, a typed store", () => (o.value = { depth: 2 }));
  attempt("an object field becomes ${b}undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
}

block1();

class C2 {
  value = { depth: 1 };
  depth(): number {
    return this.value.depth;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Object.${c} });
  attempt("an object field becomes a ${d}value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
  attempt("an object field becomes a ${d}value of another kind, asked by a typed function", () => ask2(o));
  attempt("an object field becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "object").length);
  attempt("an object field becomes a ${d}value of another kind, used", () => o.value.depth);
  attempt("an object field becomes a ${d}value of another kind, by its own method", () => o.depth());
  attempt("an object field becomes a ${d}value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an object field becomes a ${d}value of another kind, a typed store", () => (o.value = { depth: 2 }));
  attempt("an object field becomes a ${d}value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
}

block2();

class C3 {
  value: () => number = () => 1;
  run(): number {
    return this.value();
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Object.${a} });
  attempt("a function field becomes ${b}undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a function field becomes ${b}undefined, asked by a typed function", () => ask3(o));
  attempt("a function field becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a function field becomes ${b}undefined, used", () => o.value());
  attempt("a function field becomes ${b}undefined, by its own method", () => o.run());
  attempt("a function field becomes ${b}undefined, listed", () => Object.keys(o).join());
  attempt("a function field becomes ${b}undefined, a typed store", () => (o.value = () => 2));
  attempt("a function field becomes ${b}undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block3();

class C4 {
  value: () => number = () => 1;
  run(): number {
    return this.value();
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.${c} });
  attempt("a function field becomes a ${d}value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a function field becomes a ${d}value of another kind, asked by a typed function", () => ask4(o));
  attempt("a function field becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a function field becomes a ${d}value of another kind, used", () => o.value());
  attempt("a function field becomes a ${d}value of another kind, by its own method", () => o.run());
  attempt("a function field becomes a ${d}value of another kind, listed", () => Object.keys(o).join());
  attempt("a function field becomes a ${d}value of another kind, a typed store", () => (o.value = () => 2));
  attempt("a function field becomes a ${d}value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block4();

export {};
`,
    ),
    ...family(
      `tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-boolean.ts	boolean	true
tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-fraction.ts	number	0.5
tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-number.ts	number	7
tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-string.ts	string	"honest"
tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-union-of-two-literals.ts	1 | 2	2`,
      (a, b) => `type Tested = ${a};

function isUndefined(x: Tested): boolean {
  return x === undefined;
}

function isNotUndefined(x: Tested): boolean {
  return x !== undefined;
}

function isNull(x: Tested): boolean {
  return x === null;
}

function isNullish(x: Tested): boolean {
  return x == null;
}

function kindIsUndefined(x: Tested): boolean {
  return typeof x === "undefined";
}

function kindIsNumber(x: Tested): boolean {
  return typeof x === "number";
}

function kindIsNotNumber(x: Tested): boolean {
  return typeof x !== "number";
}

function kindIsString(x: Tested): boolean {
  return typeof x === "string";
}

function kindIsNotString(x: Tested): boolean {
  return typeof x !== "string";
}

function kindIsBoolean(x: Tested): boolean {
  return typeof x === "boolean";
}

function kindIsObject(x: Tested): boolean {
  return typeof x === "object";
}

function kindIsNotObject(x: Tested): boolean {
  return typeof x !== "object";
}

function kindIsFunction(x: Tested): boolean {
  return typeof x === "function";
}

function isFalsy(x: Tested): boolean {
  return !x;
}

function isTruthy(x: Tested): boolean {
  return !!x;
}

function isItself(x: Tested): boolean {
  return x === x;
}

function isAList(x: Tested): boolean {
  return Array.isArray(x);
}

const honest: Tested = ${b};
let warm = 0;
for (let i = 0; i < 2000; i++) {
  if (isUndefined(honest)) warm++;
  if (isNotUndefined(honest)) warm++;
  if (isNull(honest)) warm++;
  if (isNullish(honest)) warm++;
  if (kindIsUndefined(honest)) warm++;
  if (kindIsNumber(honest)) warm++;
  if (kindIsNotNumber(honest)) warm++;
  if (kindIsString(honest)) warm++;
  if (kindIsNotString(honest)) warm++;
  if (kindIsBoolean(honest)) warm++;
  if (kindIsObject(honest)) warm++;
  if (kindIsNotObject(honest)) warm++;
  if (kindIsFunction(honest)) warm++;
  if (isFalsy(honest)) warm++;
  if (isTruthy(honest)) warm++;
  if (isItself(honest)) warm++;
  if (isAList(honest)) warm++;
}
console.log("2000 honest rounds: " + warm);

const values: Tested[] = [honest];
const wide: unknown[] = values;
wide.push(undefined, null, 0, -0, NaN, 5, 1.5, "", "text", false, true, {}, [], () => 1, 10n, Symbol.iterator);
const labels = ["honest", "undefined", "null", "zero", "minus zero", "not a number", "five", "one and a half", "an empty string", "a text", "false", "true", "an object", "a list", "a function", "a big integer", "a symbol", "past the end"];

for (let i = 0; i < labels.length; i++) {
  const x = values[i];
  let line = labels[i] + ":";
  if (isUndefined(x)) line += " isUndefined";
  if (isNotUndefined(x)) line += " isNotUndefined";
  if (isNull(x)) line += " isNull";
  if (isNullish(x)) line += " isNullish";
  if (kindIsUndefined(x)) line += " kindIsUndefined";
  if (kindIsNumber(x)) line += " kindIsNumber";
  if (kindIsNotNumber(x)) line += " kindIsNotNumber";
  if (kindIsString(x)) line += " kindIsString";
  if (kindIsNotString(x)) line += " kindIsNotString";
  if (kindIsBoolean(x)) line += " kindIsBoolean";
  if (kindIsObject(x)) line += " kindIsObject";
  if (kindIsNotObject(x)) line += " kindIsNotObject";
  if (kindIsFunction(x)) line += " kindIsFunction";
  if (isFalsy(x)) line += " isFalsy";
  if (isTruthy(x)) line += " isTruthy";
  if (isItself(x)) line += " isItself";
  if (isAList(x)) line += " isAList";
  console.log(line);
}

export {};
`,
    ),
    ...family(
      `a-getter-is-defined-over-a-member-of-a-literal-or-an-inherited-field-right-before-the-typed-uses.ts	defineProperty(o, "value1", { get: () => undefined, enumerable: true, configurable: true	a getter of 	defineProperty(o, "value2", { get: () => "text", enumerable: true, configurable: true	getter of a 	defineProperty(o, "value", { get: () => undefined, enumerable: true, configurable: true	defineProperty(o, "value", { get: () => "text", enumerable: true, configurable: true
define-properties-writes-to-a-member-of-a-literal-or-an-inherited-field-right-before-the-typed-uses.ts	defineProperties(o, { value1: { value: undefined }		defineProperties(o, { value2: { value: "text" }		defineProperties(o, { value: { value: undefined }	defineProperties(o, { value: { value: "text" }
define-property-writes-to-a-member-of-a-literal-or-an-inherited-field-right-before-the-typed-uses.ts	defineProperty(o, "value1", { value: undefined		defineProperty(o, "value2", { value: "text"		defineProperty(o, "value", { value: undefined	defineProperty(o, "value", { value: "text"
object-assign-writes-to-a-member-of-a-literal-or-an-inherited-field-right-before-the-typed-uses.ts	assign(o, { value1: undefined		assign(o, { value2: "text"		assign(o, { value: undefined	assign(o, { value: "text"`,
      (a, b, c, d, e, f) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

interface C1 {
  value1: number;
  other1: number;
}

function ask1(o: C1): string {
  return (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1;
}

function block1(): void {
  const o: C1 = { value1: 1, other1: 2 };
  Object.${a} });
  attempt("a member of a literal becomes ${b}undefined, asked directly", () => (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1);
  attempt("a member of a literal becomes ${b}undefined, asked by a typed function", () => ask1(o));
  attempt("a member of a literal becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value1 === undefined).length + " " + [o].filter(q => typeof q.value1 === "number").length);
  attempt("a member of a literal becomes ${b}undefined, used", () => o.value1 + o.other1);
  attempt("a member of a literal becomes ${b}undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a member of a literal becomes ${b}undefined, copied", () => JSON.stringify({ ...o }));
  attempt("a member of a literal becomes ${b}undefined, a typed store", () => (o.value1 = 5));
  attempt("a member of a literal becomes ${b}undefined, asked after the store", () => (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1);
}

block1();

interface C2 {
  value2: number;
  other2: number;
}

function ask2(o: C2): string {
  return (o.value2 === undefined) + " " + (o.value2 == null) + " " + (typeof o.value2 === "number") + " " + typeof o.value2;
}

function block2(): void {
  const o: C2 = { value2: 1, other2: 2 };
  Object.${c} });
  attempt("a member of a literal becomes a ${d}value of another kind, asked directly", () => (o.value2 === undefined) + " " + (o.value2 == null) + " " + (typeof o.value2 === "number") + " " + typeof o.value2);
  attempt("a member of a literal becomes a ${d}value of another kind, asked by a typed function", () => ask2(o));
  attempt("a member of a literal becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value2 === undefined).length + " " + [o].filter(q => typeof q.value2 === "number").length);
  attempt("a member of a literal becomes a ${d}value of another kind, used", () => o.value2 + o.other2);
  attempt("a member of a literal becomes a ${d}value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a member of a literal becomes a ${d}value of another kind, copied", () => JSON.stringify({ ...o }));
  attempt("a member of a literal becomes a ${d}value of another kind, a typed store", () => (o.value2 = 5));
  attempt("a member of a literal becomes a ${d}value of another kind, asked after the store", () => (o.value2 === undefined) + " " + (o.value2 == null) + " " + (typeof o.value2 === "number") + " " + typeof o.value2);
}

block2();

class B3 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C3 extends B3 {
  extra = 2;
}

function ask3(o: B3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Object.${e} });
  attempt("an inherited field becomes ${b}undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("an inherited field becomes ${b}undefined, asked by a typed function", () => ask3(o));
  attempt("an inherited field becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("an inherited field becomes ${b}undefined, used", () => o.value + o.extra);
  attempt("an inherited field becomes ${b}undefined, by the method of the base", () => o.twice());
  attempt("an inherited field becomes ${b}undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an inherited field becomes ${b}undefined, a typed store", () => (o.value = 5));
  attempt("an inherited field becomes ${b}undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block3();

class B4 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C4 extends B4 {
  extra = 2;
}

function ask4(o: B4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.${f} });
  attempt("an inherited field becomes a ${d}value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("an inherited field becomes a ${d}value of another kind, asked by a typed function", () => ask4(o));
  attempt("an inherited field becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("an inherited field becomes a ${d}value of another kind, used", () => o.value + o.extra);
  attempt("an inherited field becomes a ${d}value of another kind, by the method of the base", () => o.twice());
  attempt("an inherited field becomes a ${d}value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an inherited field becomes a ${d}value of another kind, a typed store", () => (o.value = 5));
  attempt("an inherited field becomes a ${d}value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block4();

export {};
`,
    ),
    ...family(
      `tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-boolean.ts	boolean	true
tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-fraction.ts	number	0.5
tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-number.ts	number	7
tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-string.ts	string	"honest"
tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-union-of-two-literals.ts	1 | 2	2`,
      (a, b) => `type Tested = ${a};

function ask(run: () => boolean): boolean {
  return run();
}

function isUndefined(x: Tested): boolean {
  return ask(() => x === undefined);
}

function isNotUndefined(x: Tested): boolean {
  return ask(() => x !== undefined);
}

function isNull(x: Tested): boolean {
  return ask(() => x === null);
}

function isNullish(x: Tested): boolean {
  return ask(() => x == null);
}

function kindIsUndefined(x: Tested): boolean {
  return ask(() => typeof x === "undefined");
}

function kindIsNumber(x: Tested): boolean {
  return ask(() => typeof x === "number");
}

function kindIsNotNumber(x: Tested): boolean {
  return ask(() => typeof x !== "number");
}

function kindIsString(x: Tested): boolean {
  return ask(() => typeof x === "string");
}

function kindIsNotString(x: Tested): boolean {
  return ask(() => typeof x !== "string");
}

function kindIsBoolean(x: Tested): boolean {
  return ask(() => typeof x === "boolean");
}

function kindIsObject(x: Tested): boolean {
  return ask(() => typeof x === "object");
}

function kindIsNotObject(x: Tested): boolean {
  return ask(() => typeof x !== "object");
}

function kindIsFunction(x: Tested): boolean {
  return ask(() => typeof x === "function");
}

function isFalsy(x: Tested): boolean {
  return ask(() => !x);
}

function isTruthy(x: Tested): boolean {
  return ask(() => !!x);
}

function isItself(x: Tested): boolean {
  return ask(() => x === x);
}

function isAList(x: Tested): boolean {
  return ask(() => Array.isArray(x));
}

const honest: Tested = ${b};
let warm = 0;
for (let i = 0; i < 2000; i++) {
  if (isUndefined(honest)) warm++;
  if (isNotUndefined(honest)) warm++;
  if (isNull(honest)) warm++;
  if (isNullish(honest)) warm++;
  if (kindIsUndefined(honest)) warm++;
  if (kindIsNumber(honest)) warm++;
  if (kindIsNotNumber(honest)) warm++;
  if (kindIsString(honest)) warm++;
  if (kindIsNotString(honest)) warm++;
  if (kindIsBoolean(honest)) warm++;
  if (kindIsObject(honest)) warm++;
  if (kindIsNotObject(honest)) warm++;
  if (kindIsFunction(honest)) warm++;
  if (isFalsy(honest)) warm++;
  if (isTruthy(honest)) warm++;
  if (isItself(honest)) warm++;
  if (isAList(honest)) warm++;
}
console.log("2000 honest rounds: " + warm);

const values: Tested[] = [honest];
const wide: unknown[] = values;
wide.push(undefined, null, 0, -0, NaN, 5, 1.5, "", "text", false, true, {}, [], () => 1, 10n, Symbol.iterator);
const labels = ["honest", "undefined", "null", "zero", "minus zero", "not a number", "five", "one and a half", "an empty string", "a text", "false", "true", "an object", "a list", "a function", "a big integer", "a symbol", "past the end"];

for (let i = 0; i < labels.length; i++) {
  const x = values[i];
  let line = labels[i] + ":";
  if (isUndefined(x)) line += " isUndefined";
  if (isNotUndefined(x)) line += " isNotUndefined";
  if (isNull(x)) line += " isNull";
  if (isNullish(x)) line += " isNullish";
  if (kindIsUndefined(x)) line += " kindIsUndefined";
  if (kindIsNumber(x)) line += " kindIsNumber";
  if (kindIsNotNumber(x)) line += " kindIsNotNumber";
  if (kindIsString(x)) line += " kindIsString";
  if (kindIsNotString(x)) line += " kindIsNotString";
  if (kindIsBoolean(x)) line += " kindIsBoolean";
  if (kindIsObject(x)) line += " kindIsObject";
  if (kindIsNotObject(x)) line += " kindIsNotObject";
  if (kindIsFunction(x)) line += " kindIsFunction";
  if (isFalsy(x)) line += " isFalsy";
  if (isTruthy(x)) line += " isTruthy";
  if (isItself(x)) line += " isItself";
  if (isAList(x)) line += " isAList";
  console.log(line);
}

export {};
`,
    ),
    ...family(
      `a-literal-of-three-numbers-gets-a-getter-of-a-string-by-define-property-before-each-use.ts	defineProperty(scores, "b", { get: () => "text", enumerable: true, configurable: true
a-literal-of-three-numbers-gets-null-by-define-property-before-each-use.ts	defineProperty(scores, "b", { value: null
a-literal-of-three-numbers-gets-undefined-by-object-assign-before-each-use.ts	assign(scores, { b: undefined`,
      a => `interface Triple {
  a: number;
  b: number;
  c: number;
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("read by name", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return scores.b;
});
attempt("typeof", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return typeof scores.b;
});
attempt("is undefined", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return scores.b === undefined;
});
attempt("is a number", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return typeof scores.b === "number";
});
attempt("plus one", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return scores.b + 1;
});
attempt("in", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return "b" in scores;
});
attempt("keys", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.keys(scores).join();
});
attempt("values to kinds", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).map(value => typeof value).join();
});
attempt("values plus one", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).map(value => value + 1).join();
});
attempt("values filtered", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).filter(value => typeof value === "number").length;
});
attempt("values searched", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).findIndex(value => value === undefined);
});
attempt("values summed", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).reduce((a, b) => a + b, 0);
});
attempt("entries filtered", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.entries(scores).filter(([, value]) => typeof value === "number").length;
});
attempt("entries mapped", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.entries(scores).map(([key, value]) => key + (value + 1)).join();
});
attempt("json", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return JSON.stringify(scores);
});
attempt("a copy", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return JSON.stringify({ ...scores });
});
attempt("a copy read", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return ({ ...scores }).b + 1;
});
attempt("a pattern", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return (({ b }: Triple) => b + 1)(scores);
});
attempt("the largest", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Math.max(...Object.values(scores));
});
attempt("a typed store", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return (scores.b = 5) + " " + JSON.stringify(scores);
});

export {};
`,
    ),
    ...family(
      `tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-function.ts	() => number	() => 1
tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-list-of-numbers.ts	number[]	[1, 2]
tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-literal-object.ts	{ id: number }	{ id: 1 }
tests-that-are-returned-as-values-ask-about-a-parameter-typed-as-a-tuple.ts	[number, string]	[1, "a"]`,
      (a, b) => `type Tested = ${a};

function isUndefined(x: Tested): boolean {
  return x === undefined;
}

function isNotUndefined(x: Tested): boolean {
  return x !== undefined;
}

function isNull(x: Tested): boolean {
  return x === null;
}

function isNullish(x: Tested): boolean {
  return x == null;
}

function kindIsUndefined(x: Tested): boolean {
  return typeof x === "undefined";
}

function kindIsNumber(x: Tested): boolean {
  return typeof x === "number";
}

function kindIsNotNumber(x: Tested): boolean {
  return typeof x !== "number";
}

function kindIsString(x: Tested): boolean {
  return typeof x === "string";
}

function kindIsNotString(x: Tested): boolean {
  return typeof x !== "string";
}

function kindIsBoolean(x: Tested): boolean {
  return typeof x === "boolean";
}

function kindIsObject(x: Tested): boolean {
  return typeof x === "object";
}

function kindIsNotObject(x: Tested): boolean {
  return typeof x !== "object";
}

function kindIsFunction(x: Tested): boolean {
  return typeof x === "function";
}

function isFalsy(x: Tested): boolean {
  return !x;
}

function isTruthy(x: Tested): boolean {
  return !!x;
}

function isItself(x: Tested): boolean {
  return x === x;
}

function isAList(x: Tested): boolean {
  return Array.isArray(x);
}

function isAnObject(x: Tested): boolean {
  return x instanceof Object;
}

const honest: Tested = ${b};
let warm = 0;
for (let i = 0; i < 2000; i++) {
  if (isUndefined(honest)) warm++;
  if (isNotUndefined(honest)) warm++;
  if (isNull(honest)) warm++;
  if (isNullish(honest)) warm++;
  if (kindIsUndefined(honest)) warm++;
  if (kindIsNumber(honest)) warm++;
  if (kindIsNotNumber(honest)) warm++;
  if (kindIsString(honest)) warm++;
  if (kindIsNotString(honest)) warm++;
  if (kindIsBoolean(honest)) warm++;
  if (kindIsObject(honest)) warm++;
  if (kindIsNotObject(honest)) warm++;
  if (kindIsFunction(honest)) warm++;
  if (isFalsy(honest)) warm++;
  if (isTruthy(honest)) warm++;
  if (isItself(honest)) warm++;
  if (isAList(honest)) warm++;
  if (isAnObject(honest)) warm++;
}
console.log("2000 honest rounds: " + warm);

const values: Tested[] = [honest];
const wide: unknown[] = values;
wide.push(undefined, null, 0, -0, NaN, 5, 1.5, "", "text", false, true, {}, [], () => 1, 10n, Symbol.iterator);
const labels = ["honest", "undefined", "null", "zero", "minus zero", "not a number", "five", "one and a half", "an empty string", "a text", "false", "true", "an object", "a list", "a function", "a big integer", "a symbol", "past the end"];

for (let i = 0; i < labels.length; i++) {
  const x = values[i];
  let line = labels[i] + ":";
  if (isUndefined(x)) line += " isUndefined";
  if (isNotUndefined(x)) line += " isNotUndefined";
  if (isNull(x)) line += " isNull";
  if (isNullish(x)) line += " isNullish";
  if (kindIsUndefined(x)) line += " kindIsUndefined";
  if (kindIsNumber(x)) line += " kindIsNumber";
  if (kindIsNotNumber(x)) line += " kindIsNotNumber";
  if (kindIsString(x)) line += " kindIsString";
  if (kindIsNotString(x)) line += " kindIsNotString";
  if (kindIsBoolean(x)) line += " kindIsBoolean";
  if (kindIsObject(x)) line += " kindIsObject";
  if (kindIsNotObject(x)) line += " kindIsNotObject";
  if (kindIsFunction(x)) line += " kindIsFunction";
  if (isFalsy(x)) line += " isFalsy";
  if (isTruthy(x)) line += " isTruthy";
  if (isItself(x)) line += " isItself";
  if (isAList(x)) line += " isAList";
  if (isAnObject(x)) line += " isAnObject";
  console.log(line);
}

export {};
`,
    ),
    ...family(
      `a-field-typed-as-a-boolean-holds-every-other-kind-and-tests-of-it-are-returned-as-values.ts	flag	flag === bag.flag	flag ? "yes" : "no"
a-field-typed-as-a-fraction-holds-every-other-kind-and-tests-of-it-are-returned-as-values.ts	fraction	fraction === bag.fraction	fraction * 2
a-field-typed-as-a-function-holds-every-other-kind-and-tests-of-it-are-returned-as-values.ts	run	run === bag.run	run()
a-field-typed-as-a-list-holds-every-other-kind-and-tests-of-it-are-returned-as-values.ts	list	list === bag.list	list.length
a-field-typed-as-a-string-holds-every-other-kind-and-tests-of-it-are-returned-as-values.ts	text	text === bag.text	text + "!"
a-field-typed-as-an-instance-holds-every-other-kind-and-tests-of-it-are-returned-as-values.ts	point	point === bag.point	point.x
a-field-typed-as-an-integer-holds-every-other-kind-and-tests-of-it-are-returned-as-values.ts	integer	integer === bag.integer	integer + 1`,
      (a, b, c) => `class Point {
  x = 1;
}

class Bag {
  integer = 1;
  fraction = 0.5;
  text = "t";
  flag = true;
  point = new Point();
  run: () => number = () => 1;
  list: number[] = [1];
  nothing: undefined = undefined;
  none: null = null;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function isUndefined(bag: Bag): boolean {
  return bag.${a} === undefined;
}

function isNull(bag: Bag): boolean {
  return bag.${a} === null;
}

function isNullish(bag: Bag): boolean {
  return bag.${a} == null;
}

function kindIsUndefined(bag: Bag): boolean {
  return typeof bag.${a} === "undefined";
}

function kindIsNumber(bag: Bag): boolean {
  return typeof bag.${a} === "number";
}

function kindIsString(bag: Bag): boolean {
  return typeof bag.${a} === "string";
}

function kindIsBoolean(bag: Bag): boolean {
  return typeof bag.${a} === "boolean";
}

function kindIsObject(bag: Bag): boolean {
  return typeof bag.${a} === "object";
}

function kindIsFunction(bag: Bag): boolean {
  return typeof bag.${a} === "function";
}

function isFalsy(bag: Bag): boolean {
  return !bag.${a};
}

function isItself(bag: Bag): boolean {
  return bag.${b};
}

function use(bag: Bag): string {
  try {
    return String(bag.${c});
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

const honest = new Bag();
let warm = 0;
for (let i = 0; i < 2000; i++) {
  if (isUndefined(honest)) warm++;
  if (isNull(honest)) warm++;
  if (isNullish(honest)) warm++;
  if (kindIsUndefined(honest)) warm++;
  if (kindIsNumber(honest)) warm++;
  if (kindIsString(honest)) warm++;
  if (kindIsBoolean(honest)) warm++;
  if (kindIsObject(honest)) warm++;
  if (kindIsFunction(honest)) warm++;
  if (isFalsy(honest)) warm++;
  if (isItself(honest)) warm++;
  warm += use(honest).length;
}
console.log("2000 honest rounds: " + warm);

function chosen(): keyof Bag {
  return process.argv.length > 0 ? "${a}" : "nothing";
}

const key = chosen();
const values: [string, Bag[keyof Bag]][] = [
  ["an integer", 7],
  ["a fraction", 2.5],
  ["zero", 0],
  ["not a number", NaN],
  ["a text", "text"],
  ["an empty text", ""],
  ["true", true],
  ["false", false],
  ["a point", new Point()],
  ["a function", () => 2],
  ["a list", [1, 2]],
  ["undefined", undefined],
  ["null", null],
];

for (const [label, value] of values) {
  const bag = new Bag();
  set(bag, key, value);
  let line = label + ": " + typeof bag.${a} + " |";
  if (isUndefined(bag)) line += " isUndefined";
  if (isNull(bag)) line += " isNull";
  if (isNullish(bag)) line += " isNullish";
  if (kindIsUndefined(bag)) line += " kindIsUndefined";
  if (kindIsNumber(bag)) line += " kindIsNumber";
  if (kindIsString(bag)) line += " kindIsString";
  if (kindIsBoolean(bag)) line += " kindIsBoolean";
  if (kindIsObject(bag)) line += " kindIsObject";
  if (kindIsFunction(bag)) line += " kindIsFunction";
  if (isFalsy(bag)) line += " isFalsy";
  if (isItself(bag)) line += " isItself";
  console.log(line + " | " + use(bag) + " | " + Object.keys(bag).length);
}

export {};
`,
    ),
    ...family(
      `tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-function.ts	() => number	() => 1
tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-list-of-numbers.ts	number[]	[1, 2]
tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-literal-object.ts	{ id: number }	{ id: 1 }
tests-inside-closures-ask-about-a-captured-parameter-typed-as-a-tuple.ts	[number, string]	[1, "a"]`,
      (a, b) => `type Tested = ${a};

function ask(run: () => boolean): boolean {
  return run();
}

function isUndefined(x: Tested): boolean {
  return ask(() => x === undefined);
}

function isNotUndefined(x: Tested): boolean {
  return ask(() => x !== undefined);
}

function isNull(x: Tested): boolean {
  return ask(() => x === null);
}

function isNullish(x: Tested): boolean {
  return ask(() => x == null);
}

function kindIsUndefined(x: Tested): boolean {
  return ask(() => typeof x === "undefined");
}

function kindIsNumber(x: Tested): boolean {
  return ask(() => typeof x === "number");
}

function kindIsNotNumber(x: Tested): boolean {
  return ask(() => typeof x !== "number");
}

function kindIsString(x: Tested): boolean {
  return ask(() => typeof x === "string");
}

function kindIsNotString(x: Tested): boolean {
  return ask(() => typeof x !== "string");
}

function kindIsBoolean(x: Tested): boolean {
  return ask(() => typeof x === "boolean");
}

function kindIsObject(x: Tested): boolean {
  return ask(() => typeof x === "object");
}

function kindIsNotObject(x: Tested): boolean {
  return ask(() => typeof x !== "object");
}

function kindIsFunction(x: Tested): boolean {
  return ask(() => typeof x === "function");
}

function isFalsy(x: Tested): boolean {
  return ask(() => !x);
}

function isTruthy(x: Tested): boolean {
  return ask(() => !!x);
}

function isItself(x: Tested): boolean {
  return ask(() => x === x);
}

function isAList(x: Tested): boolean {
  return ask(() => Array.isArray(x));
}

function isAnObject(x: Tested): boolean {
  return ask(() => x instanceof Object);
}

const honest: Tested = ${b};
let warm = 0;
for (let i = 0; i < 2000; i++) {
  if (isUndefined(honest)) warm++;
  if (isNotUndefined(honest)) warm++;
  if (isNull(honest)) warm++;
  if (isNullish(honest)) warm++;
  if (kindIsUndefined(honest)) warm++;
  if (kindIsNumber(honest)) warm++;
  if (kindIsNotNumber(honest)) warm++;
  if (kindIsString(honest)) warm++;
  if (kindIsNotString(honest)) warm++;
  if (kindIsBoolean(honest)) warm++;
  if (kindIsObject(honest)) warm++;
  if (kindIsNotObject(honest)) warm++;
  if (kindIsFunction(honest)) warm++;
  if (isFalsy(honest)) warm++;
  if (isTruthy(honest)) warm++;
  if (isItself(honest)) warm++;
  if (isAList(honest)) warm++;
  if (isAnObject(honest)) warm++;
}
console.log("2000 honest rounds: " + warm);

const values: Tested[] = [honest];
const wide: unknown[] = values;
wide.push(undefined, null, 0, -0, NaN, 5, 1.5, "", "text", false, true, {}, [], () => 1, 10n, Symbol.iterator);
const labels = ["honest", "undefined", "null", "zero", "minus zero", "not a number", "five", "one and a half", "an empty string", "a text", "false", "true", "an object", "a list", "a function", "a big integer", "a symbol", "past the end"];

for (let i = 0; i < labels.length; i++) {
  const x = values[i];
  let line = labels[i] + ":";
  if (isUndefined(x)) line += " isUndefined";
  if (isNotUndefined(x)) line += " isNotUndefined";
  if (isNull(x)) line += " isNull";
  if (isNullish(x)) line += " isNullish";
  if (kindIsUndefined(x)) line += " kindIsUndefined";
  if (kindIsNumber(x)) line += " kindIsNumber";
  if (kindIsNotNumber(x)) line += " kindIsNotNumber";
  if (kindIsString(x)) line += " kindIsString";
  if (kindIsNotString(x)) line += " kindIsNotString";
  if (kindIsBoolean(x)) line += " kindIsBoolean";
  if (kindIsObject(x)) line += " kindIsObject";
  if (kindIsNotObject(x)) line += " kindIsNotObject";
  if (kindIsFunction(x)) line += " kindIsFunction";
  if (isFalsy(x)) line += " isFalsy";
  if (isTruthy(x)) line += " isTruthy";
  if (isItself(x)) line += " isItself";
  if (isAList(x)) line += " isAList";
  if (isAnObject(x)) line += " isAnObject";
  console.log(line);
}

export {};
`,
    ),
    ...family(
      `a-record-of-numbers-gets-a-getter-of-a-string-by-define-property-before-each-use.ts	defineProperty(scores, "b", { get: () => "text", enumerable: true, configurable: true
a-record-of-numbers-gets-null-by-define-property-before-each-use.ts	defineProperty(scores, "b", { value: null
a-record-of-numbers-gets-undefined-by-object-assign-before-each-use.ts	assign(scores, { b: undefined`,
      a => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("read by name", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return scores.b;
});
attempt("read by a key", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return scores["b"];
});
attempt("typeof", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return typeof scores.b;
});
attempt("is undefined", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return scores.b === undefined;
});
attempt("is a number", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return typeof scores.b === "number";
});
attempt("plus one", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return scores.b + 1;
});
attempt("in", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return "b" in scores;
});
attempt("keys", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.keys(scores).join();
});
attempt("values to kinds", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).map(value => typeof value).join();
});
attempt("values plus one", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).map(value => value + 1).join();
});
attempt("values filtered", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).filter(value => typeof value === "number").length;
});
attempt("values searched", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).findIndex(value => value === undefined);
});
attempt("values summed", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.values(scores).reduce((a, b) => a + b, 0);
});
attempt("entries filtered", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.entries(scores).filter(([, value]) => typeof value === "number").length;
});
attempt("entries mapped", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Object.entries(scores).map(([key, value]) => key + (value + 1)).join();
});
attempt("for-in", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return (() => {
    let total = 0;
    for (const key in scores) total += scores[key];
    return total;
  })();
});
attempt("json", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return JSON.stringify(scores);
});
attempt("a copy", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return JSON.stringify({ ...scores });
});
attempt("a copy read", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return ({ ...scores }).b + 1;
});
attempt("a pattern", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return (({ b }: Record<string, number>) => b + 1)(scores);
});
attempt("the largest", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return Math.max(...Object.values(scores));
});
attempt("a typed store", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Object.${a} });
  return (scores.b = 5) + " " + JSON.stringify(scores);
});

export {};
`,
    ),
    ...family(
      `a-list-of-objects-gets-a-hole-by-reflect-delete-property-before-each-use.ts	deleteProperty(list, 1
a-list-of-objects-gets-another-shape-by-reflect-set-before-each-use.ts	set(list, 1, { deep: 1 }
a-list-of-objects-gets-undefined-by-reflect-set-before-each-use.ts	set(list, 1, undefined`,
      a => `interface Part {
  depth: number;
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("typeof", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return typeof list[1];
});
attempt("is undefined", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list[1] === undefined;
});
attempt("is truthy", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return !!list[1];
});
attempt("its member", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list[1].depth;
});
attempt("an optional chain", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list[1]?.depth;
});
attempt("in", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return 1 in list;
});
attempt("for-of", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return (() => {
    let total = 0;
    for (const part of list) total += part.depth;
    return total;
  })();
});
attempt("map to kinds", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.map(part => typeof part).join();
});
attempt("map to members", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.map(part => part.depth).join();
});
attempt("filter undefined", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.filter(part => part === undefined).length;
});
attempt("filter objects", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.filter(part => typeof part === "object" && part !== null).length;
});
attempt("filter by truth", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.filter(part => part).length;
});
attempt("findIndex", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.findIndex(part => !part);
});
attempt("some", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.some(part => part == null);
});
attempt("every", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.every(part => part instanceof Object);
});
attempt("reduce", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.reduce((sum, part) => sum + part.depth, 0);
});
attempt("a pattern in a callback", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.map(({ depth }) => depth).join();
});
attempt("json", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return JSON.stringify(list);
});
attempt("spread", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return [...list].length;
});
attempt("a default in a pattern", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return (([, b = { depth: -1 }]: Part[]) => b.depth)(list);
});
attempt("toSorted", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return list.toSorted((a, b) => b.depth - a.depth).length;
});
attempt("a typed store", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.${a});
  return (list[1] = { depth: 9 }).depth + " " + JSON.stringify(list);
});

export {};
`,
    ),
    ...family(
      `a-proxy-is-used-as-a-config.ts	new Proxy(config(80), {}	new Proxy(source, {})
a-structured-clone-is-used-as-a-config.ts	structuredClone(config(80)	structuredClone(source)
an-assigned-copy-is-used-as-a-config.ts	Object.assign({}, config(80)	Object.assign({}, source)
configs-made-by-a-literal-honest.ts	config(80	source`,
      (a, b) => `function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

interface Config {
  port: number;
  ratio: number;
  host: string;
  secure: boolean;
  paths: string[];
  limits: { max: number };
  note?: string;
}

function config(port: number): Config {
  return { port, ratio: 0.5, host: "localhost", secure: true, paths: ["/"], limits: { max: 10 } };
}

const uses: [string, (c: Config) => unknown][] = [
  ["typeof", c => typeof c],
  ["port + 1", c => c.port + 1],
  ["ratio * 2", c => c.ratio * 2],
  ["port | 0", c => c.port | 0],
  ["length of the host", c => c.host.length],
  ["the host and the port", c => c.host + ":" + c.port],
  ["secure", c => (c.secure ? "yes" : "no")],
  ["exactly true", c => c.secure === true],
  ["paths", c => [c.paths.length, c.paths[0]]],
  ["the limit", c => c.limits.max + 1],
  ["note", c => c.note ?? "no note"],
  ["kinds", c => [typeof c.port, typeof c.ratio, typeof c.host, typeof c.secure, typeof c.paths, typeof c.limits, typeof c.note]],
  ["a store to the port", c => {
    c.port = 81.5;
    return [c.port, c.port + c.ratio];
  }],
  ["port++", c => {
    c.port++;
    return c.port;
  }],
  ["a store to the host", c => {
    c.host = "example";
    return c.host.length;
  }],
  ["a store to the note", c => {
    c.note = "noted";
    return [c.note, Object.keys(c)];
  }],
  ["delete the note", c => [delete c.note, "note" in c]],
  ["a pushed path", c => c.paths.push("/more")],
  ["a store to the limit", c => {
    c.limits.max = 20;
    return c.limits.max;
  }],
  ["in", c => ["port" in c, "note" in c, "missing" in c]],
  ["own", c => [Object.hasOwn(c, "port"), Object.hasOwn(c, "host")]],
  ["keys", c => Object.keys(c)],
  ["JSON", c => JSON.stringify(c)],
  ["for-in", c => {
    const names: string[] = [];
    for (const name in c) names.push(name);
    return names;
  }],
  ["a pattern", c => {
    const { port, host, limits: { max } } = c;
    return [port, host, max];
  }],
  ["a spread", c => ({ ...c, port: 1 })],
  ["prototype", c => Object.getPrototypeOf(c) === Object.prototype],
];

function address(c: Config): string {
  return c.host + ":" + c.port;
}

function budget(c: Config): number {
  return c.limits.max * c.ratio + c.port;
}

function move(c: Config, port: number): number {
  c.port = port;
  return c.port;
}

class Server {
  name = "server";
  config: Config;
  started = 0.5;
  constructor(config: Config) {
    this.config = config;
  }
  address(): string {
    return this.config.host + ":" + this.config.port;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = config(i);
  warm += address(honest).length + budget(honest) + move(honest, 1) + new Server(honest).address().length;
}
for (const [, use] of uses) for (let i = 0; i < 200; i++) use(config(i));
console.log("after the honest configs", warm);

for (const [name, use] of uses) {
  attempt(name, () => use(${a})));
}
{
  const source = config(80);
  const made = ${b};
  attempt("typed functions", () => [address(made), budget(made), move(made, 8080)]);
  attempt("in a field", () => {
    const server = new Server(made);
    return [server.name, server.address(), server.started];
  });
  attempt("among honest configs", () => [config(1), made, config(2)].map(budget));
  attempt("is it the source", () => made === source);
  attempt("the source afterwards", () => [source.port, source.host, source.paths, Object.keys(source)]);
  attempt("a store to the source is seen", () => {
    source.port = 100;
    source.paths.push("/late");
    return [made.port, made.paths];
  });
}
attempt("honest again", () => [address(config(80)), budget(config(80)), move(config(80), 1)]);
`,
    ),
    ...family(
      `reflect-delete-property-removes-a-number-field-in-constructors-methods-and-initializers.ts	deleteProperty(this, "value"
reflect-set-puts-a-string-into-a-number-field-in-constructors-methods-and-initializers.ts	set(this, "value", "text"
reflect-set-puts-undefined-into-a-number-field-in-constructors-methods-and-initializers.ts	set(this, "value", undefined`,
      a => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  value = 1;
  constructor() {
    Reflect.${a});
  }
  twice(): number {
    return this.value * 2;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  attempt("written by its own constructor, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by its own constructor, asked by a typed function", () => ask1(o));
  attempt("written by its own constructor, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by its own constructor, used", () => o.value + 1);
  attempt("written by its own constructor, by its own method", () => o.twice());
}

block1();

class C2 {
  value = 1;
  spoil(): void {
    Reflect.${a});
  }
  twice(): number {
    return this.value * 2;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  o.spoil();
  attempt("written by its own method, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by its own method, asked by a typed function", () => ask2(o));
  attempt("written by its own method, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by its own method, used", () => o.value + 1);
  attempt("written by its own method, by its own method", () => o.twice());
}

block2();

class B3 {
  constructor() {
    Reflect.${a});
  }
}

class C3 extends B3 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  attempt("written by the constructor of its base, before the field is defined, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by the constructor of its base, before the field is defined, asked by a typed function", () => ask3(o));
  attempt("written by the constructor of its base, before the field is defined, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by the constructor of its base, before the field is defined, used", () => o.value + 1);
  attempt("written by the constructor of its base, before the field is defined, by its own method", () => o.twice());
}

block3();

class B4 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C4 extends B4 {
  constructor() {
    super();
    Reflect.${a});
  }
}

function ask4(o: B4): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  attempt("written by the constructor of a subclass, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by the constructor of a subclass, asked by a typed function", () => ask4(o));
  attempt("written by the constructor of a subclass, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by the constructor of a subclass, used", () => o.value + 1);
  attempt("written by the constructor of a subclass, by its own method", () => o.twice());
}

block4();

class C5 {
  value = 1;
  later = (() => {
    Reflect.${a});
    return 2;
  })();
  twice(): number {
    return this.value * 2;
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  attempt("written by an initializer of a later field, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by an initializer of a later field, asked by a typed function", () => ask5(o));
  attempt("written by an initializer of a later field, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by an initializer of a later field, used", () => o.value + 1);
  attempt("written by an initializer of a later field, by its own method", () => o.twice());
}

block5();

export {};
`,
    ),
    ...family(
      `define-properties-writes-to-a-member-of-a-prototype-a-class-or-a-function-right-before-the-typed-uses.ts	defineProperties(C1.prototype, { value: { value: undefined }	defineProperties(C2.prototype, { value: { value: 5 }	defineProperties(C3, { value: { value: undefined }	defineProperties(C4, { value: { value: "text" }	defineProperties(f, { value: { value: undefined }	defineProperties(f, { value: { value: "text" }
define-property-writes-to-a-member-of-a-prototype-a-class-or-a-function-right-before-the-typed-uses.ts	defineProperty(C1.prototype, "value", { value: undefined	defineProperty(C2.prototype, "value", { value: 5	defineProperty(C3, "value", { value: undefined	defineProperty(C4, "value", { value: "text"	defineProperty(f, "value", { value: undefined	defineProperty(f, "value", { value: "text"
object-assign-writes-to-a-member-of-a-prototype-a-class-or-a-function-right-before-the-typed-uses.ts	assign(C1.prototype, { value: undefined	assign(C2.prototype, { value: 5	assign(C3, { value: undefined	assign(C4, { value: "text"	assign(f, { value: undefined	assign(f, { value: "text"`,
      (a, b, c, d, e, f) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  level = 1;
  value(): number {
    return this.level;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Object.${a} });
  attempt("a method of a prototype becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a method of a prototype becomes undefined, asked by a typed function", () => ask1(o));
  attempt("a method of a prototype becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a method of a prototype becomes undefined, used", () => o.value());
  attempt("a method of a prototype becomes undefined, on a new instance", () => new C1().value());
  attempt("a method of a prototype becomes undefined, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C1.prototype).join());
  attempt("a method of a prototype becomes undefined, a typed store", () => (o.value = () => 2));
  attempt("a method of a prototype becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block1();

class C2 {
  level = 1;
  value(): number {
    return this.level;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Object.${b} });
  attempt("a method of a prototype becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a method of a prototype becomes a value of another kind, asked by a typed function", () => ask2(o));
  attempt("a method of a prototype becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a method of a prototype becomes a value of another kind, used", () => o.value());
  attempt("a method of a prototype becomes a value of another kind, on a new instance", () => new C2().value());
  attempt("a method of a prototype becomes a value of another kind, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C2.prototype).join());
  attempt("a method of a prototype becomes a value of another kind, a typed store", () => (o.value = () => 2));
  attempt("a method of a prototype becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block2();

class C3 {
  static value = 1;
  static twice(): number {
    return C3.value * 2;
  }
}

function ask3(o: typeof C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  Object.${c} });
  attempt("a static field becomes undefined, asked directly", () => (C3.value === undefined) + " " + (C3.value == null) + " " + (typeof C3.value === "number") + " " + typeof C3.value);
  attempt("a static field becomes undefined, asked by a typed function", () => ask3(C3));
  attempt("a static field becomes undefined, asked by a callback", () => [C3].filter(q => q.value === undefined).length + " " + [C3].filter(q => typeof q.value === "number").length);
  attempt("a static field becomes undefined, used", () => C3.value + 1);
  attempt("a static field becomes undefined, by a static method", () => C3.twice());
  attempt("a static field becomes undefined, listed", () => Object.keys(C3).join());
  attempt("a static field becomes undefined, a typed store", () => (C3.value = 5));
  attempt("a static field becomes undefined, asked after the store", () => (C3.value === undefined) + " " + (C3.value == null) + " " + (typeof C3.value === "number") + " " + typeof C3.value);
}

block3();

class C4 {
  static value = 1;
  static twice(): number {
    return C4.value * 2;
  }
}

function ask4(o: typeof C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  Object.${d} });
  attempt("a static field becomes a value of another kind, asked directly", () => (C4.value === undefined) + " " + (C4.value == null) + " " + (typeof C4.value === "number") + " " + typeof C4.value);
  attempt("a static field becomes a value of another kind, asked by a typed function", () => ask4(C4));
  attempt("a static field becomes a value of another kind, asked by a callback", () => [C4].filter(q => q.value === undefined).length + " " + [C4].filter(q => typeof q.value === "number").length);
  attempt("a static field becomes a value of another kind, used", () => C4.value + 1);
  attempt("a static field becomes a value of another kind, by a static method", () => C4.twice());
  attempt("a static field becomes a value of another kind, listed", () => Object.keys(C4).join());
  attempt("a static field becomes a value of another kind, a typed store", () => (C4.value = 5));
  attempt("a static field becomes a value of another kind, asked after the store", () => (C4.value === undefined) + " " + (C4.value == null) + " " + (typeof C4.value === "number") + " " + typeof C4.value);
}

block4();

function ask5(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Object.${e} });
  attempt("a member of a function becomes undefined, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("a member of a function becomes undefined, asked by a typed function", () => ask5(f));
  attempt("a member of a function becomes undefined, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("a member of a function becomes undefined, used", () => f.value + 1);
  attempt("a member of a function becomes undefined, called", () => f(2));
  attempt("a member of a function becomes undefined, listed", () => Object.keys(f).join());
  attempt("a member of a function becomes undefined, a typed store", () => (f.value = 5));
  attempt("a member of a function becomes undefined, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block5();

function ask6(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block6(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Object.${f} });
  attempt("a member of a function becomes a value of another kind, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("a member of a function becomes a value of another kind, asked by a typed function", () => ask6(f));
  attempt("a member of a function becomes a value of another kind, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("a member of a function becomes a value of another kind, used", () => f.value + 1);
  attempt("a member of a function becomes a value of another kind, called", () => f(2));
  attempt("a member of a function becomes a value of another kind, listed", () => Object.keys(f).join());
  attempt("a member of a function becomes a value of another kind, a typed store", () => (f.value = 5));
  attempt("a member of a function becomes a value of another kind, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block6();

export {};
`,
    ),
    ...family(
      `a-proxy-of-a-proxy-is-used-as-a-point.ts	new Proxy(new Proxy(new Point(3, 4), {}), {}	new Proxy(new Proxy(source, {}), {})
a-proxy-without-traps-is-used-as-a-point.ts	new Proxy(new Point(3, 4), {}	new Proxy(source, {})
a-structured-clone-is-used-as-a-point.ts	structuredClone(new Point(3, 4)	structuredClone(source)
object-assign-onto-a-literal-is-used-as-a-point.ts	Object.assign({}, new Point(3, 4)	Object.assign({}, source)
points-made-by-their-constructor-honest.ts	new Point(3, 4	source`,
      (a, b) => `function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x: number;
  y: number;
  label = "point";
  visible = true;
  tags: string[] = ["first"];
  origin: { id: number } = { id: 7 };
  note?: string;
  #secret = 42;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
  secret(): number {
    return this.#secret;
  }
  static isPoint(value: object): boolean {
    return #secret in value;
  }
}

const uses: [string, (p: Point) => unknown][] = [
  ["typeof", p => typeof p],
  ["x + 1", p => p.x + 1],
  ["y * 2", p => p.y * 2],
  ["x | 0", p => p.x | 0],
  ["length of the label", p => p.label.length],
  ["the label and a mark", p => p.label + "!"],
  ["visible", p => (p.visible ? "yes" : "no")],
  ["exactly true", p => p.visible === true],
  ["tags", p => [p.tags.length, p.tags[0]]],
  ["id of the origin", p => p.origin.id],
  ["note", p => p.note ?? "no note"],
  ["norm()", p => p.norm()],
  ["typeof norm", p => typeof p.norm],
  ["the prototype's norm", p => p.norm === Point.prototype.norm],
  ["the getter", p => p.sum],
  ["the setter", p => {
    p.sum = 9;
    return [p.x, p.y, Object.keys(p)];
  }],
  ["the private name", p => p.secret()],
  ["the brand", p => Point.isPoint(p)],
  ["instanceof", p => p instanceof Point],
  ["constructor", p => p.constructor === Point],
  ["prototype", p => Object.getPrototypeOf(p) === Point.prototype],
  ["a store to x", p => {
    p.x = 10.5;
    return [p.x, p.x + p.y];
  }],
  ["x++", p => {
    p.x++;
    return p.x;
  }],
  ["a store to the label", p => {
    p.label = "renamed";
    return p.label.length;
  }],
  ["a store to the note", p => {
    p.note = "noted";
    return [p.note, Object.keys(p)];
  }],
  ["delete the note", p => [delete p.note, "note" in p]],
  ["a pushed tag", p => p.tags.push("second")],
  ["x in", p => ["x" in p, "norm" in p, "sum" in p, "missing" in p]],
  ["own", p => [Object.hasOwn(p, "x"), Object.hasOwn(p, "norm"), Object.hasOwn(p, "sum")]],
  ["keys", p => Object.keys(p)],
  ["JSON", p => JSON.stringify(p)],
  ["for-in", p => {
    const names: string[] = [];
    for (const name in p) names.push(name);
    return names;
  }],
  ["a pattern", p => {
    const { x, y, label } = p;
    return [x, y, label];
  }],
  ["a method taken off and put back", p => {
    const norm = p.norm;
    return norm.call(p);
  }],
];

function total(p: Point): number {
  return p.x + p.y;
}

function distance(p: Point): number {
  return p.norm();
}

function rename(p: Point, label: string): string {
  p.label = label;
  return p.label;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Point(i, 0.5);
  warm += total(honest) + distance(honest) + rename(honest, "n").length;
}
for (const [, use] of uses) for (let i = 0; i < 200; i++) use(new Point(i, 0.5));
console.log("after the honest points", warm);

for (const [name, use] of uses) {
  attempt(name, () => use(${a})));
}
{
  const source = new Point(3, 4);
  const made = ${b};
  attempt("typed functions", () => [total(made), distance(made), rename(made, "again")]);
  attempt("is it the source", () => made === source);
  attempt("the source afterwards", () => [source.x, source.y, source.label, source.tags, Object.keys(source)]);
  attempt("a store to the source is seen", () => {
    source.x = 100;
    source.tags.push("late");
    return [made.x, made.tags];
  });
}
attempt("honest again", () => [total(new Point(3, 4)), distance(new Point(3, 4)), rename(new Point(3, 4), "honest")]);
`,
    ),
    ...family(
      `a-copy-of-the-descriptors-without-a-prototype-is-used-as-a-point.ts	orphan	Object.defineProperties(Object.create(null), Object.getOwnPropertyDescriptors(source)
a-copy-of-the-prototype-and-the-descriptors-is-used-as-a-point.ts	twin	Object.create(Object.getPrototypeOf(source), Object.getOwnPropertyDescriptors(source)
a-json-round-trip-is-used-as-a-point.ts	roundTrip	JSON.parse(JSON.stringify(source)
a-literal-given-the-prototype-is-used-as-a-point.ts	dressed	Object.setPrototypeOf({ y: source.y, extra: "more", x: source.x, label: source.label }, Point.prototype
an-object-created-from-an-instance-is-used-as-a-point.ts	child	Object.create(source
an-object-created-from-the-prototype-is-used-as-a-point.ts	bare	Object.create(Object.getPrototypeOf(source)
object-assign-onto-the-bare-prototype-is-used-as-a-point.ts	copy	Object.assign(Object.create(Point.prototype), source`,
      (a, b) => `function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x: number;
  y: number;
  label = "point";
  visible = true;
  tags: string[] = ["first"];
  origin: { id: number } = { id: 7 };
  note?: string;
  #secret = 42;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
  secret(): number {
    return this.#secret;
  }
  static isPoint(value: object): boolean {
    return #secret in value;
  }
}

function ${a}(source: Point): Point {
  return ${b});
}

const uses: [string, (p: Point) => unknown][] = [
  ["typeof", p => typeof p],
  ["x + 1", p => p.x + 1],
  ["y * 2", p => p.y * 2],
  ["x | 0", p => p.x | 0],
  ["length of the label", p => p.label.length],
  ["the label and a mark", p => p.label + "!"],
  ["visible", p => (p.visible ? "yes" : "no")],
  ["exactly true", p => p.visible === true],
  ["tags", p => [p.tags.length, p.tags[0]]],
  ["id of the origin", p => p.origin.id],
  ["note", p => p.note ?? "no note"],
  ["norm()", p => p.norm()],
  ["typeof norm", p => typeof p.norm],
  ["the prototype's norm", p => p.norm === Point.prototype.norm],
  ["the getter", p => p.sum],
  ["the setter", p => {
    p.sum = 9;
    return [p.x, p.y, Object.keys(p)];
  }],
  ["the private name", p => p.secret()],
  ["the brand", p => Point.isPoint(p)],
  ["instanceof", p => p instanceof Point],
  ["constructor", p => p.constructor === Point],
  ["prototype", p => Object.getPrototypeOf(p) === Point.prototype],
  ["a store to x", p => {
    p.x = 10.5;
    return [p.x, p.x + p.y];
  }],
  ["x++", p => {
    p.x++;
    return p.x;
  }],
  ["a store to the label", p => {
    p.label = "renamed";
    return p.label.length;
  }],
  ["a store to the note", p => {
    p.note = "noted";
    return [p.note, Object.keys(p)];
  }],
  ["delete the note", p => [delete p.note, "note" in p]],
  ["a pushed tag", p => p.tags.push("second")],
  ["x in", p => ["x" in p, "norm" in p, "sum" in p, "missing" in p]],
  ["own", p => [Object.hasOwn(p, "x"), Object.hasOwn(p, "norm"), Object.hasOwn(p, "sum")]],
  ["keys", p => Object.keys(p)],
  ["JSON", p => JSON.stringify(p)],
  ["for-in", p => {
    const names: string[] = [];
    for (const name in p) names.push(name);
    return names;
  }],
  ["a pattern", p => {
    const { x, y, label } = p;
    return [x, y, label];
  }],
  ["a method taken off and put back", p => {
    const norm = p.norm;
    return norm.call(p);
  }],
];

function total(p: Point): number {
  return p.x + p.y;
}

function distance(p: Point): number {
  return p.norm();
}

function rename(p: Point, label: string): string {
  p.label = label;
  return p.label;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Point(i, 0.5);
  warm += total(honest) + distance(honest) + rename(honest, "n").length;
}
for (const [, use] of uses) for (let i = 0; i < 200; i++) use(new Point(i, 0.5));
console.log("after the honest points", warm);

for (const [name, use] of uses) {
  attempt(name, () => use(${a}(new Point(3, 4))));
}
{
  const source = new Point(3, 4);
  const made = ${a}(source);
  attempt("typed functions", () => [total(made), distance(made), rename(made, "again")]);
  attempt("is it the source", () => made === source);
  attempt("the source afterwards", () => [source.x, source.y, source.label, source.tags, Object.keys(source)]);
  attempt("a store to the source is seen", () => {
    source.x = 100;
    source.tags.push("late");
    return [made.x, made.tags];
  });
}
attempt("honest again", () => [total(new Point(3, 4)), distance(new Point(3, 4)), rename(new Point(3, 4), "honest")]);
`,
    ),
    ...family(
      `define-property-gives-the-members-of-a-function-other-values.ts	Object.defineProperty(c, "calls", { value: "text" }	Object.defineProperty(c, "calls", { value: undefined }	Object.defineProperty(c, "label", { value: 7 }	Object.defineProperty(c, "reset", { value: 5 }	Object.defineProperty(c, "reset", { value: () => "nothing" }	Object.defineProperty(c, "name", { value: "renamed" }	Object.defineProperty(c, "name", { value: 5 }	Object.defineProperty(c, "length", { value: 9 }	Object.defineProperty(c, "call", { value: () => "own call" }	Object.defineProperty(c, "bind", { value: () => () => "own bind" }
object-assign-gives-the-members-of-a-function-other-values.ts	Object.assign(c, { calls: "text" }	Object.assign(c, { calls: undefined }	Object.assign(c, { label: 7 }	Object.assign(c, { reset: 5 }	Object.assign(c, { reset: () => "nothing" }	Object.assign(c, { name: "renamed" }	Object.assign(c, { name: 5 }	Object.assign(c, { length: 9 }	Object.assign(c, { call: () => "own call" }	Object.assign(c, { bind: () => () => "own bind" }
reflect-set-gives-the-members-of-a-function-other-values.ts	Reflect.set(c, "calls", "text"	Reflect.set(c, "calls", undefined	Reflect.set(c, "label", 7	Reflect.set(c, "reset", 5	Reflect.set(c, "reset", () => "nothing"	Reflect.set(c, "name", "renamed"	Reflect.set(c, "name", 5	Reflect.set(c, "length", 9	Reflect.set(c, "call", () => "own call"	Reflect.set(c, "bind", () => () => "own bind"`,
      (a, b, c, d, e, f, g, h, i, j) => `interface Counter {
  (step: number): number;
  calls: number;
  label: string;
  reset(): void;
}

function makeCounter(): Counter {
  const counter: Counter = Object.assign(
    function count(step: number): number {
      counter.calls += 1;
      return step * 2;
    },
    {
      calls: 0,
      label: "counter",
      reset(): void {
        counter.calls = 0;
      },
    },
  );
  return counter;
}

function invoke(c: Counter): number {
  return c(2);
}

function callsPlusOne(c: Counter): number {
  return c.calls + 1;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;
}

function use(label: string, c: Counter): void {
  attempt(label + ", called", () => c(2));
  attempt(label + ", a typed function calls it", () => invoke(c));
  attempt(label + ", calls", () => c.calls);
  attempt(label + ", typeof calls", () => typeof c.calls);
  attempt(label + ", calls is a number", () => typeof c.calls === "number");
  attempt(label + ", calls is undefined", () => c.calls === undefined);
  attempt(label + ", reset is a function", () => typeof c.reset === "function");
  attempt(label + ", calls plus one", () => c.calls + 1);
  attempt(label + ", a typed function reads calls", () => callsPlusOne(c));
  attempt(label + ", the length of the label", () => c.label.length);
  attempt(label + ", reset", () => (c.reset(), c.calls));
  attempt(label + ", its name", () => c.name);
  attempt(label + ", its length", () => c.length);
  attempt(label + ", typeof", () => typeof c);
  attempt(label + ", through call", () => c.call(undefined, 3));
  attempt(label + ", through apply", () => c.apply(undefined, [4]));
  attempt(label + ", bound", () => c.bind(undefined, 5)());
  attempt(label + ", keys", () => Object.keys(c).join());
  attempt(label + ", a copy", () => JSON.stringify({ ...c }));
  attempt(label + ", instanceof Function", () => c instanceof Function);
  attempt(label + ", handed to map", () => [1, 2].map(c).join());
  attempt(label + ", calls stored", () => (c.calls = 50));
  attempt(label + ", calls incremented", () => ++c.calls);
  attempt(label + ", the label stored", () => (c.label = "stored"));
  attempt(label + ", called again", () => c(6) + c.calls);
}

class Holder {
  counter: Counter;
  constructor(counter: Counter) {
    this.counter = counter;
  }
}

function inPlaces(label: string, make: () => Counter): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.counter(2) + holder.counter.calls);
  const list: Counter[] = [makeCounter(), make()];
  attempt(label + ", an element", () => list[1](2) + list[1].calls);
  attempt(label + ", a result", () => make()(2));
}

function inALoop(label: string, write: (c: Counter) => void): void {
  const c = makeCounter();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(c);
      const value = c(1) + c.calls + c.label.length;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

const writes: [string, (c: Counter) => void][] = [
  ["calls becomes a string", c => { ${a}); }],
  ["calls becomes undefined", c => { ${b}); }],
  ["the label becomes a number", c => { ${c}); }],
  ["reset becomes a number", c => { ${d}); }],
  ["reset becomes another function", c => { ${e}); }],
  ["the name is changed", c => { ${f}); }],
  ["the name becomes a number", c => { ${g}); }],
  ["the length is changed", c => { ${h}); }],
  ["an own member named call", c => { ${i}); }],
  ["an own member named bind", c => { ${j}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) use("", makeCounter());
inPlaces("", makeCounter);
inALoop("", () => {});
quiet = false;

use("untouched", makeCounter());

for (const [label, write] of writes) {
  const c = makeCounter();
  attempt(label + ", the write itself", () => write(c));
  use(label, c);
  inPlaces(label, () => {
    const made = makeCounter();
    try {
      write(made);
    } catch {
      log.push("the write threw");
    }
    return made;
  });
  inALoop(label, write);
}

use("untouched afterwards", makeCounter());

export {};
`,
    ),
    ...family(
      `define-property-gives-a-string-field-of-an-instance-other-values.ts	Object.defineProperty(p, "label", { value: 7 }	Object.defineProperty(p, "label", { value: undefined }	Object.defineProperty(p, "label", { value: null }	Object.defineProperty(p, "label", { value: ["a", "b"] }	Object.defineProperty(p, "label", { value: { length: 3 }	Object.defineProperty(p, "label", { value: Symbol("s") }
object-assign-gives-a-string-field-of-an-instance-other-values.ts	Object.assign(p, { label: 7 }	Object.assign(p, { label: undefined }	Object.assign(p, { label: null }	Object.assign(p, { label: ["a", "b"] }	Object.assign(p, { label: { length: 3 }	Object.assign(p, { label: Symbol("s") }
reflect-set-gives-a-string-field-of-an-instance-other-values.ts	Reflect.set(p, "label", 7	Reflect.set(p, "label", undefined	Reflect.set(p, "label", null	Reflect.set(p, "label", ["a", "b"]	Reflect.set(p, "label", { length: 3	Reflect.set(p, "label", Symbol("s")`,
      (a, b, c, d, e, f) => `interface Inner {
  depth: number;
}

class Part {
  count = 1;
  label = "part";
  inner: Inner = { depth: 2 };
  action: () => number = () => 3;
  note?: string = "note";
  readonly id: number = 4;
  total(): number {
    return this.count + this.inner.depth + this.action() + this.id;
  }
  title(): string {
    return this.label + ":" + (this.note ?? "none");
  }
}

class SubPart extends Part {
  extra = 5;
  total(): number {
    return super.total() + this.extra;
  }
}

function fresh(): Part {
  return new Part();
}

function other(): Part {
  return new SubPart();
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function lengthOf(p: Part): number {
  return p.label.length;
}

function useLabel(label: string, p: Part): void {
  attempt(label + ", read", () => p.label);
  attempt(label + ", typeof", () => typeof p.label);
  attempt(label + ", its length", () => p.label.length);
  attempt(label + ", glued", () => p.label + "!");
  attempt(label + ", a method of the string", () => p.label.toUpperCase());
  attempt(label + ", compared", () => p.label === "part");
  attempt(label + ", is undefined", () => p.label === undefined);
  attempt(label + ", is a string", () => typeof p.label === "string");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.label === "string").length);
  attempt(label + ", a typed function", () => lengthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", appended to", () => (p.label += "?"));
  attempt(label + ", stored", () => (p.label = "stored"));
  attempt(label + ", read after the store", () => p.label);
}

function briefLabel(label: string, p: Part): void {
  attempt(label + ", used", () => p.label.length);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function labelInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.label.length);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].label.length);
  attempt(label + ", a result", () => make().label.length);
}

function labelInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.label.length;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const labelWrites: [string, (p: Part) => void][] = [
  ["label becomes a number", p => { ${a}); }],
  ["label becomes undefined", p => { ${b}); }],
  ["label becomes null", p => { ${c}); }],
  ["label becomes an array", p => { ${d}); }],
  ["label becomes an object with a length", p => { ${e} }); }],
  ["label becomes a symbol", p => { ${f}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useLabel("", fresh());
  briefLabel("", other());
}
labelInPlaces("", fresh);
labelInALoop("", () => {});
quiet = false;

useLabel("untouched", fresh());

for (const [label, write] of labelWrites) {
  const first = fresh();
  write(first);
  useLabel(label + ", an instance", first);
  const second = other();
  write(second);
  briefLabel(label + ", a subclass instance", second);
  labelInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  labelInALoop(label, write);
}

useLabel("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `define-property-gives-a-function-field-of-an-instance-other-values.ts	Object.defineProperty(p, "action", { value: 5 }	Object.defineProperty(p, "action", { value: undefined }	Object.defineProperty(p, "action", { value: "text" }	Object.defineProperty(p, "action", { value: () => "text" }	Object.defineProperty(p, "action", { value: class {} 	Object.defineProperty(p, "action", { value: { call: () => 1 }	Object.defineProperty(p, "action", { value: Math.max.bind(null, 1, 2) }	Object.defineProperty(p, "action", { value: async () => 1 }
object-assign-gives-a-function-field-of-an-instance-other-values.ts	Object.assign(p, { action: 5 }	Object.assign(p, { action: undefined }	Object.assign(p, { action: "text" }	Object.assign(p, { action: () => "text" }	Object.assign(p, { action: class {} 	Object.assign(p, { action: { call: () => 1 }	Object.assign(p, { action: Math.max.bind(null, 1, 2) }	Object.assign(p, { action: async () => 1 }
reflect-set-gives-a-function-field-of-an-instance-other-values.ts	Reflect.set(p, "action", 5	Reflect.set(p, "action", undefined	Reflect.set(p, "action", "text"	Reflect.set(p, "action", () => "text"	Reflect.set(p, "action", class {	Reflect.set(p, "action", { call: () => 1	Reflect.set(p, "action", Math.max.bind(null, 1, 2)	Reflect.set(p, "action", async () => 1`,
      (a, b, c, d, e, f, g, h) => `interface Inner {
  depth: number;
}

class Part {
  count = 1;
  label = "part";
  inner: Inner = { depth: 2 };
  action: () => number = () => 3;
  note?: string = "note";
  readonly id: number = 4;
  total(): number {
    return this.count + this.inner.depth + this.action() + this.id;
  }
  title(): string {
    return this.label + ":" + (this.note ?? "none");
  }
}

class SubPart extends Part {
  extra = 5;
  total(): number {
    return super.total() + this.extra;
  }
}

function fresh(): Part {
  return new Part();
}

function other(): Part {
  return new SubPart();
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function run(p: Part): number {
  return p.action();
}

function useAction(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.action);
  attempt(label + ", is undefined", () => p.action === undefined);
  attempt(label + ", is a function", () => typeof p.action === "function");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.action === "function").length);
  attempt(label + ", called", () => p.action());
  attempt(label + ", its result plus one", () => p.action() + 1);
  attempt(label + ", taken off and called", () => (f => f())(p.action));
  attempt(label + ", through call", () => p.action.call(undefined));
  attempt(label + ", its length", () => p.action.length);
  attempt(label + ", a typed function", () => run(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", replaced and called", () => (p.action = () => 30)());
  attempt(label + ", called after that", () => p.action());
}

function briefAction(label: string, p: Part): void {
  attempt(label + ", used", () => p.action());
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function actionInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.action());
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].action());
  attempt(label + ", a result", () => make().action());
}

function actionInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.action();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const actionWrites: [string, (p: Part) => void][] = [
  ["action becomes a number", p => { ${a}); }],
  ["action becomes undefined", p => { ${b}); }],
  ["action becomes a string", p => { ${c}); }],
  ["action becomes a function that answers a string", p => { ${d}); }],
  ["action becomes a class", p => { ${e}}); }],
  ["action becomes an object with call", p => { ${f} }); }],
  ["action becomes a bound built-in", p => { ${g}); }],
  ["action becomes an async function", p => { ${h}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useAction("", fresh());
  briefAction("", other());
}
actionInPlaces("", fresh);
actionInALoop("", () => {});
quiet = false;

useAction("untouched", fresh());

for (const [label, write] of actionWrites) {
  const first = fresh();
  write(first);
  useAction(label + ", an instance", first);
  const second = other();
  write(second);
  briefAction(label + ", a subclass instance", second);
  actionInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  actionInALoop(label, write);
}

useAction("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `define-property-gives-a-number-field-of-an-instance-other-values.ts	Object.defineProperty(p, "count", { value: "text" }	Object.defineProperty(p, "count", { value: "12" }	Object.defineProperty(p, "count", { value: undefined }	Object.defineProperty(p, "count", { value: null }	Object.defineProperty(p, "count", { value: true }	Object.defineProperty(p, "count", { value: 1.5 }	Object.defineProperty(p, "count", { value: { valueOf: () => 42 }	Object.defineProperty(p, "count", { value: 10n }	Object.defineProperty(p, "count", { value: [7] }
object-assign-gives-a-number-field-of-an-instance-other-values.ts	Object.assign(p, { count: "text" }	Object.assign(p, { count: "12" }	Object.assign(p, { count: undefined }	Object.assign(p, { count: null }	Object.assign(p, { count: true }	Object.assign(p, { count: 1.5 }	Object.assign(p, { count: { valueOf: () => 42 }	Object.assign(p, { count: 10n }	Object.assign(p, { count: [7] }
reflect-set-gives-a-number-field-of-an-instance-other-values.ts	Reflect.set(p, "count", "text"	Reflect.set(p, "count", "12"	Reflect.set(p, "count", undefined	Reflect.set(p, "count", null	Reflect.set(p, "count", true	Reflect.set(p, "count", 1.5	Reflect.set(p, "count", { valueOf: () => 42	Reflect.set(p, "count", 10n	Reflect.set(p, "count", [7]`,
      (a, b, c, d, e, f, g, h, i) => `interface Inner {
  depth: number;
}

class Part {
  count = 1;
  label = "part";
  inner: Inner = { depth: 2 };
  action: () => number = () => 3;
  note?: string = "note";
  readonly id: number = 4;
  total(): number {
    return this.count + this.inner.depth + this.action() + this.id;
  }
  title(): string {
    return this.label + ":" + (this.note ?? "none");
  }
}

class SubPart extends Part {
  extra = 5;
  total(): number {
    return super.total() + this.extra;
  }
}

function fresh(): Part {
  return new Part();
}

function other(): Part {
  return new SubPart();
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function plusOne(p: Part): number {
  return p.count + 1;
}

function useCount(label: string, p: Part): void {
  attempt(label + ", read", () => p.count);
  attempt(label + ", typeof", () => typeof p.count);
  attempt(label + ", plus one", () => p.count + 1);
  attempt(label + ", doubled", () => p.count * 2);
  attempt(label + ", as an integer", () => p.count | 0);
  attempt(label + ", compared", () => p.count > 0);
  attempt(label + ", is undefined", () => p.count === undefined);
  attempt(label + ", is null or undefined", () => p.count == null);
  attempt(label + ", is a number", () => typeof p.count === "number");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.count === "number").length);
  attempt(label + ", a method of the number", () => p.count.toFixed(1));
  attempt(label + ", a typed function", () => plusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", incremented", () => ++p.count);
  attempt(label + ", stored", () => (p.count = 10));
  attempt(label + ", read after the store", () => p.count);
}

function briefCount(label: string, p: Part): void {
  attempt(label + ", used", () => p.count + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function countInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.count + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].count + 1);
  attempt(label + ", a result", () => make().count + 1);
}

function countInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.count + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const countWrites: [string, (p: Part) => void][] = [
  ["count becomes a string", p => { ${a}); }],
  ["count becomes a string of digits", p => { ${b}); }],
  ["count becomes undefined", p => { ${c}); }],
  ["count becomes null", p => { ${d}); }],
  ["count becomes true", p => { ${e}); }],
  ["count becomes a fraction", p => { ${f}); }],
  ["count becomes an object with valueOf", p => { ${g} }); }],
  ["count becomes a big integer", p => { ${h}); }],
  ["count becomes an array", p => { ${i}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useCount("", fresh());
  briefCount("", other());
}
countInPlaces("", fresh);
countInALoop("", () => {});
quiet = false;

useCount("untouched", fresh());

for (const [label, write] of countWrites) {
  const first = fresh();
  write(first);
  useCount(label + ", an instance", first);
  const second = other();
  write(second);
  briefCount(label + ", a subclass instance", second);
  countInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  countInALoop(label, write);
}

useCount("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `define-property-gives-an-object-field-of-an-instance-other-values.ts	Object.defineProperty(p, "inner", { value: 5 }	Object.defineProperty(p, "inner", { value: "text" }	Object.defineProperty(p, "inner", { value: null }	Object.defineProperty(p, "inner", { value: undefined }	Object.defineProperty(p, "inner", { value: { deep: 1 }	Object.defineProperty(p, "inner", { value: { extra: 0, depth: 6 }	Object.defineProperty(p, "inner", { value: [1, 2] }	Object.defineProperty(p, "inner", { value: () => 1 }	Object.defineProperty(p, "inner", { value: { depth: "deep" }
object-assign-gives-an-object-field-of-an-instance-other-values.ts	Object.assign(p, { inner: 5 }	Object.assign(p, { inner: "text" }	Object.assign(p, { inner: null }	Object.assign(p, { inner: undefined }	Object.assign(p, { inner: { deep: 1 }	Object.assign(p, { inner: { extra: 0, depth: 6 }	Object.assign(p, { inner: [1, 2] }	Object.assign(p, { inner: () => 1 }	Object.assign(p, { inner: { depth: "deep" }
reflect-set-gives-an-object-field-of-an-instance-other-values.ts	Reflect.set(p, "inner", 5	Reflect.set(p, "inner", "text"	Reflect.set(p, "inner", null	Reflect.set(p, "inner", undefined	Reflect.set(p, "inner", { deep: 1	Reflect.set(p, "inner", { extra: 0, depth: 6	Reflect.set(p, "inner", [1, 2]	Reflect.set(p, "inner", () => 1	Reflect.set(p, "inner", { depth: "deep"`,
      (a, b, c, d, e, f, g, h, i) => `interface Inner {
  depth: number;
}

class Part {
  count = 1;
  label = "part";
  inner: Inner = { depth: 2 };
  action: () => number = () => 3;
  note?: string = "note";
  readonly id: number = 4;
  total(): number {
    return this.count + this.inner.depth + this.action() + this.id;
  }
  title(): string {
    return this.label + ":" + (this.note ?? "none");
  }
}

class SubPart extends Part {
  extra = 5;
  total(): number {
    return super.total() + this.extra;
  }
}

function fresh(): Part {
  return new Part();
}

function other(): Part {
  return new SubPart();
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function depthOf(p: Part): number {
  return p.inner.depth;
}

function useInner(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.inner);
  attempt(label + ", is undefined", () => p.inner === undefined);
  attempt(label + ", is null", () => p.inner === null);
  attempt(label + ", is truthy", () => !!p.inner);
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.inner === "object" && q.inner !== null).length);
  attempt(label + ", its member", () => p.inner.depth);
  attempt(label + ", its member plus one", () => p.inner.depth + 1);
  attempt(label + ", its keys", () => Object.keys(p.inner).join());
  attempt(label + ", a copy of it", () => JSON.stringify({ ...p.inner }));
  attempt(label + ", in", () => "depth" in p.inner);
  attempt(label + ", a pattern", () => (({ depth }: Inner) => depth)(p.inner));
  attempt(label + ", a typed function", () => depthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", its member stored", () => (p.inner.depth = 9));
  attempt(label + ", its member after the store", () => p.inner.depth);
  attempt(label + ", replaced", () => (p.inner = { depth: 8 }).depth);
  attempt(label + ", its member after that", () => p.inner.depth);
}

function briefInner(label: string, p: Part): void {
  attempt(label + ", used", () => p.inner.depth);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function innerInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.inner.depth);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].inner.depth);
  attempt(label + ", a result", () => make().inner.depth);
}

function innerInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.inner.depth;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const innerWrites: [string, (p: Part) => void][] = [
  ["inner becomes a number", p => { ${a}); }],
  ["inner becomes a string", p => { ${b}); }],
  ["inner becomes null", p => { ${c}); }],
  ["inner becomes undefined", p => { ${d}); }],
  ["inner becomes another shape", p => { ${e} }); }],
  ["inner becomes the member and more", p => { ${f} }); }],
  ["inner becomes an array", p => { ${g}); }],
  ["inner becomes a function", p => { ${h}); }],
  ["inner becomes a string under the member", p => { ${i} }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useInner("", fresh());
  briefInner("", other());
}
innerInPlaces("", fresh);
innerInALoop("", () => {});
quiet = false;

useInner("untouched", fresh());

for (const [label, write] of innerWrites) {
  const first = fresh();
  write(first);
  useInner(label + ", an instance", first);
  const second = other();
  write(second);
  briefInner(label + ", a subclass instance", second);
  innerInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  innerInALoop(label, write);
}

useInner("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `a-getter-is-defined-over-a-number-a-string-or-a-boolean-field-right-before-the-typed-uses.ts	defineProperty(o, "value", { get: () => undefined, enumerable: true, configurable: true	a getter of 	defineProperty(o, "value", { get: () => "text", enumerable: true, configurable: true	getter of a 	defineProperty(o, "value", { get: () => 7, enumerable: true, configurable: true
define-properties-writes-to-a-number-a-string-or-a-boolean-field-right-before-the-typed-uses.ts	defineProperties(o, { value: { value: undefined }		defineProperties(o, { value: { value: "text" }		defineProperties(o, { value: { value: 7 }
define-property-writes-to-a-number-a-string-or-a-boolean-field-right-before-the-typed-uses.ts	defineProperty(o, "value", { value: undefined		defineProperty(o, "value", { value: "text"		defineProperty(o, "value", { value: 7
object-assign-writes-to-a-number-a-string-or-a-boolean-field-right-before-the-typed-uses.ts	assign(o, { value: undefined		assign(o, { value: "text"		assign(o, { value: 7`,
      (a, b, c, d, e) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Object.${a} });
  attempt("a number field becomes ${b}undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a number field becomes ${b}undefined, asked by a typed function", () => ask1(o));
  attempt("a number field becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a number field becomes ${b}undefined, used", () => o.value + 1);
  attempt("a number field becomes ${b}undefined, by its own method", () => o.twice());
  attempt("a number field becomes ${b}undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a number field becomes ${b}undefined, a typed store", () => (o.value = 5));
  attempt("a number field becomes ${b}undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block1();

class C2 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Object.${c} });
  attempt("a number field becomes a ${d}value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a number field becomes a ${d}value of another kind, asked by a typed function", () => ask2(o));
  attempt("a number field becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a number field becomes a ${d}value of another kind, used", () => o.value + 1);
  attempt("a number field becomes a ${d}value of another kind, by its own method", () => o.twice());
  attempt("a number field becomes a ${d}value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a number field becomes a ${d}value of another kind, a typed store", () => (o.value = 5));
  attempt("a number field becomes a ${d}value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block2();

class C3 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Object.${a} });
  attempt("a string field becomes ${b}undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("a string field becomes ${b}undefined, asked by a typed function", () => ask3(o));
  attempt("a string field becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("a string field becomes ${b}undefined, used", () => o.value.length);
  attempt("a string field becomes ${b}undefined, by its own method", () => o.size());
  attempt("a string field becomes ${b}undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a string field becomes ${b}undefined, a typed store", () => (o.value = "t"));
  attempt("a string field becomes ${b}undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block3();

class C4 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.${e} });
  attempt("a string field becomes a ${d}value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("a string field becomes a ${d}value of another kind, asked by a typed function", () => ask4(o));
  attempt("a string field becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("a string field becomes a ${d}value of another kind, used", () => o.value.length);
  attempt("a string field becomes a ${d}value of another kind, by its own method", () => o.size());
  attempt("a string field becomes a ${d}value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a string field becomes a ${d}value of another kind, a typed store", () => (o.value = "t"));
  attempt("a string field becomes a ${d}value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block4();

class C5 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  Object.${a} });
  attempt("a boolean field becomes ${b}undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("a boolean field becomes ${b}undefined, asked by a typed function", () => ask5(o));
  attempt("a boolean field becomes ${b}undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("a boolean field becomes ${b}undefined, used", () => o.value ? "truthy" : "falsy");
  attempt("a boolean field becomes ${b}undefined, by its own method", () => o.word());
  attempt("a boolean field becomes ${b}undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a boolean field becomes ${b}undefined, a typed store", () => (o.value = false));
  attempt("a boolean field becomes ${b}undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block5();

class C6 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask6(o: C6): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block6(): void {
  const o = new C6();
  Object.${c} });
  attempt("a boolean field becomes a ${d}value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("a boolean field becomes a ${d}value of another kind, asked by a typed function", () => ask6(o));
  attempt("a boolean field becomes a ${d}value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("a boolean field becomes a ${d}value of another kind, used", () => o.value ? "truthy" : "falsy");
  attempt("a boolean field becomes a ${d}value of another kind, by its own method", () => o.word());
  attempt("a boolean field becomes a ${d}value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a boolean field becomes a ${d}value of another kind, a typed store", () => (o.value = false));
  attempt("a boolean field becomes a ${d}value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block6();

export {};
`,
    ),
    ...family(
      `define-properties-writes-to-an-element-of-an-array-or-a-tuple-right-before-the-typed-uses.ts	defineProperties(list, { 1: { value: undefined }	defineProperties(list, { 1: { value: "text" }	defineProperties(list, { 1: { value: 7 }	defineProperties(list, { 1: { value: 5 }
define-property-writes-to-an-element-of-an-array-or-a-tuple-right-before-the-typed-uses.ts	defineProperty(list, 1, { value: undefined	defineProperty(list, 1, { value: "text"	defineProperty(list, 1, { value: 7	defineProperty(list, 1, { value: 5
object-assign-writes-to-an-element-of-an-array-or-a-tuple-right-before-the-typed-uses.ts	assign(list, { 1: undefined	assign(list, { 1: "text"	assign(list, { 1: 7	assign(list, { 1: 5`,
      (a, b, c, d) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

function ask1(o: number[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "number") + " " + typeof o[1];
}

function block1(): void {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  attempt("an element of numbers becomes undefined, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("an element of numbers becomes undefined, asked by a typed function", () => ask1(list));
  attempt("an element of numbers becomes undefined, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("an element of numbers becomes undefined, used", () => list[1] + 1);
  attempt("an element of numbers becomes undefined, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("an element of numbers becomes undefined, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of numbers becomes undefined, a typed store", () => (list[1] = 5));
  attempt("an element of numbers becomes undefined, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block1();

function ask2(o: number[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "number") + " " + typeof o[1];
}

function block2(): void {
  const list: number[] = [1, 2, 3];
  Object.${b} });
  attempt("an element of numbers becomes a value of another kind, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("an element of numbers becomes a value of another kind, asked by a typed function", () => ask2(list));
  attempt("an element of numbers becomes a value of another kind, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("an element of numbers becomes a value of another kind, used", () => list[1] + 1);
  attempt("an element of numbers becomes a value of another kind, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("an element of numbers becomes a value of another kind, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of numbers becomes a value of another kind, a typed store", () => (list[1] = 5));
  attempt("an element of numbers becomes a value of another kind, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block2();

function ask3(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block3(): void {
  const list: string[] = ["a", "b", "c"];
  Object.${a} });
  attempt("an element of strings becomes undefined, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of strings becomes undefined, asked by a typed function", () => ask3(list));
  attempt("an element of strings becomes undefined, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("an element of strings becomes undefined, used", () => list[1].length);
  attempt("an element of strings becomes undefined, joined", () => list.join("+"));
  attempt("an element of strings becomes undefined, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of strings becomes undefined, a typed store", () => (list[1] = "z"));
  attempt("an element of strings becomes undefined, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block3();

function ask4(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block4(): void {
  const list: string[] = ["a", "b", "c"];
  Object.${c} });
  attempt("an element of strings becomes a value of another kind, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of strings becomes a value of another kind, asked by a typed function", () => ask4(list));
  attempt("an element of strings becomes a value of another kind, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("an element of strings becomes a value of another kind, used", () => list[1].length);
  attempt("an element of strings becomes a value of another kind, joined", () => list.join("+"));
  attempt("an element of strings becomes a value of another kind, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of strings becomes a value of another kind, a typed store", () => (list[1] = "z"));
  attempt("an element of strings becomes a value of another kind, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block4();

interface C5 {
  depth5: number;
}

function ask5(o: C5[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block5(): void {
  const list: C5[] = [{ depth5: 1 }, { depth5: 2 }, { depth5: 3 }];
  Object.${a} });
  attempt("an element of objects becomes undefined, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("an element of objects becomes undefined, asked by a typed function", () => ask5(list));
  attempt("an element of objects becomes undefined, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("an element of objects becomes undefined, used", () => list[1].depth5);
  attempt("an element of objects becomes undefined, mapped", () => list.map(part => part.depth5).join());
  attempt("an element of objects becomes undefined, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of objects becomes undefined, a typed store", () => (list[1] = { depth5: 9 }));
  attempt("an element of objects becomes undefined, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block5();

interface C6 {
  depth6: number;
}

function ask6(o: C6[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block6(): void {
  const list: C6[] = [{ depth6: 1 }, { depth6: 2 }, { depth6: 3 }];
  Object.${d} });
  attempt("an element of objects becomes a value of another kind, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("an element of objects becomes a value of another kind, asked by a typed function", () => ask6(list));
  attempt("an element of objects becomes a value of another kind, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("an element of objects becomes a value of another kind, used", () => list[1].depth6);
  attempt("an element of objects becomes a value of another kind, mapped", () => list.map(part => part.depth6).join());
  attempt("an element of objects becomes a value of another kind, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of objects becomes a value of another kind, a typed store", () => (list[1] = { depth6: 9 }));
  attempt("an element of objects becomes a value of another kind, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block6();

function ask7(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block7(): void {
  const list: [number, string] = [1, "one"];
  Object.${a} });
  attempt("an element of a tuple becomes undefined, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of a tuple becomes undefined, asked by a typed function", () => ask7(list));
  attempt("an element of a tuple becomes undefined, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("an element of a tuple becomes undefined, used", () => list[1].length + list[0]);
  attempt("an element of a tuple becomes undefined, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("an element of a tuple becomes undefined, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of a tuple becomes undefined, a typed store", () => (list[1] = "two"));
  attempt("an element of a tuple becomes undefined, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block7();

function ask8(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block8(): void {
  const list: [number, string] = [1, "one"];
  Object.${c} });
  attempt("an element of a tuple becomes a value of another kind, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of a tuple becomes a value of another kind, asked by a typed function", () => ask8(list));
  attempt("an element of a tuple becomes a value of another kind, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("an element of a tuple becomes a value of another kind, used", () => list[1].length + list[0]);
  attempt("an element of a tuple becomes a value of another kind, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("an element of a tuple becomes a value of another kind, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of a tuple becomes a value of another kind, a typed store", () => (list[1] = "two"));
  attempt("an element of a tuple becomes a value of another kind, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block8();

export {};
`,
    ),
    ...family(
      `define-property-gives-a-string-member-of-a-literal-other-values.ts	Object.defineProperty(p, "label", { value: 7 }	Object.defineProperty(p, "label", { value: undefined }	Object.defineProperty(p, "label", { value: null }	Object.defineProperty(p, "label", { value: ["a", "b"] }	Object.defineProperty(p, "label", { value: { length: 3 }	Object.defineProperty(p, "label", { value: Symbol("s") }
object-assign-gives-a-string-member-of-a-literal-other-values.ts	Object.assign(p, { label: 7 }	Object.assign(p, { label: undefined }	Object.assign(p, { label: null }	Object.assign(p, { label: ["a", "b"] }	Object.assign(p, { label: { length: 3 }	Object.assign(p, { label: Symbol("s") }
reflect-set-gives-a-string-member-of-a-literal-other-values.ts	Reflect.set(p, "label", 7	Reflect.set(p, "label", undefined	Reflect.set(p, "label", null	Reflect.set(p, "label", ["a", "b"]	Reflect.set(p, "label", { length: 3	Reflect.set(p, "label", Symbol("s")`,
      (a, b, c, d, e, f) => `interface Inner {
  depth: number;
}

interface Part {
  count: number;
  label: string;
  inner: Inner;
  action: () => number;
  note?: string;
  readonly id: number;
  total(): number;
  title(): string;
}

function fresh(): Part {
  return {
    count: 1,
    label: "part",
    inner: { depth: 2 },
    action: () => 3,
    note: "note",
    id: 4,
    total() {
      return this.count + this.inner.depth + this.action() + this.id;
    },
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
  };
}

function other(): Part {
  return {
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
    total() {
      return this.count + this.inner.depth + this.action() + this.id + 5;
    },
    id: 4,
    note: "note",
    action: () => 3,
    inner: { depth: 2 },
    label: "part",
    count: 1,
  };
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function lengthOf(p: Part): number {
  return p.label.length;
}

function useLabel(label: string, p: Part): void {
  attempt(label + ", read", () => p.label);
  attempt(label + ", typeof", () => typeof p.label);
  attempt(label + ", its length", () => p.label.length);
  attempt(label + ", glued", () => p.label + "!");
  attempt(label + ", a method of the string", () => p.label.toUpperCase());
  attempt(label + ", compared", () => p.label === "part");
  attempt(label + ", is undefined", () => p.label === undefined);
  attempt(label + ", is a string", () => typeof p.label === "string");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.label === "string").length);
  attempt(label + ", a typed function", () => lengthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", appended to", () => (p.label += "?"));
  attempt(label + ", stored", () => (p.label = "stored"));
  attempt(label + ", read after the store", () => p.label);
}

function briefLabel(label: string, p: Part): void {
  attempt(label + ", used", () => p.label.length);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function labelInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.label.length);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].label.length);
  attempt(label + ", a result", () => make().label.length);
}

function labelInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.label.length;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const labelWrites: [string, (p: Part) => void][] = [
  ["label becomes a number", p => { ${a}); }],
  ["label becomes undefined", p => { ${b}); }],
  ["label becomes null", p => { ${c}); }],
  ["label becomes an array", p => { ${d}); }],
  ["label becomes an object with a length", p => { ${e} }); }],
  ["label becomes a symbol", p => { ${f}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useLabel("", fresh());
  briefLabel("", other());
}
labelInPlaces("", fresh);
labelInALoop("", () => {});
quiet = false;

useLabel("untouched", fresh());

for (const [label, write] of labelWrites) {
  const first = fresh();
  write(first);
  useLabel(label + ", a literal", first);
  const second = other();
  write(second);
  briefLabel(label + ", a literal written backwards", second);
  labelInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  labelInALoop(label, write);
}

useLabel("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `define-property-gives-a-function-member-of-a-literal-other-values.ts	Object.defineProperty(p, "action", { value: 5 }	Object.defineProperty(p, "action", { value: undefined }	Object.defineProperty(p, "action", { value: "text" }	Object.defineProperty(p, "action", { value: () => "text" }	Object.defineProperty(p, "action", { value: class {} 	Object.defineProperty(p, "action", { value: { call: () => 1 }	Object.defineProperty(p, "action", { value: Math.max.bind(null, 1, 2) }	Object.defineProperty(p, "action", { value: async () => 1 }
object-assign-gives-a-function-member-of-a-literal-other-values.ts	Object.assign(p, { action: 5 }	Object.assign(p, { action: undefined }	Object.assign(p, { action: "text" }	Object.assign(p, { action: () => "text" }	Object.assign(p, { action: class {} 	Object.assign(p, { action: { call: () => 1 }	Object.assign(p, { action: Math.max.bind(null, 1, 2) }	Object.assign(p, { action: async () => 1 }
reflect-set-gives-a-function-member-of-a-literal-other-values.ts	Reflect.set(p, "action", 5	Reflect.set(p, "action", undefined	Reflect.set(p, "action", "text"	Reflect.set(p, "action", () => "text"	Reflect.set(p, "action", class {	Reflect.set(p, "action", { call: () => 1	Reflect.set(p, "action", Math.max.bind(null, 1, 2)	Reflect.set(p, "action", async () => 1`,
      (a, b, c, d, e, f, g, h) => `interface Inner {
  depth: number;
}

interface Part {
  count: number;
  label: string;
  inner: Inner;
  action: () => number;
  note?: string;
  readonly id: number;
  total(): number;
  title(): string;
}

function fresh(): Part {
  return {
    count: 1,
    label: "part",
    inner: { depth: 2 },
    action: () => 3,
    note: "note",
    id: 4,
    total() {
      return this.count + this.inner.depth + this.action() + this.id;
    },
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
  };
}

function other(): Part {
  return {
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
    total() {
      return this.count + this.inner.depth + this.action() + this.id + 5;
    },
    id: 4,
    note: "note",
    action: () => 3,
    inner: { depth: 2 },
    label: "part",
    count: 1,
  };
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function run(p: Part): number {
  return p.action();
}

function useAction(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.action);
  attempt(label + ", is undefined", () => p.action === undefined);
  attempt(label + ", is a function", () => typeof p.action === "function");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.action === "function").length);
  attempt(label + ", called", () => p.action());
  attempt(label + ", its result plus one", () => p.action() + 1);
  attempt(label + ", taken off and called", () => (f => f())(p.action));
  attempt(label + ", through call", () => p.action.call(undefined));
  attempt(label + ", its length", () => p.action.length);
  attempt(label + ", a typed function", () => run(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", replaced and called", () => (p.action = () => 30)());
  attempt(label + ", called after that", () => p.action());
}

function briefAction(label: string, p: Part): void {
  attempt(label + ", used", () => p.action());
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function actionInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.action());
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].action());
  attempt(label + ", a result", () => make().action());
}

function actionInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.action();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const actionWrites: [string, (p: Part) => void][] = [
  ["action becomes a number", p => { ${a}); }],
  ["action becomes undefined", p => { ${b}); }],
  ["action becomes a string", p => { ${c}); }],
  ["action becomes a function that answers a string", p => { ${d}); }],
  ["action becomes a class", p => { ${e}}); }],
  ["action becomes an object with call", p => { ${f} }); }],
  ["action becomes a bound built-in", p => { ${g}); }],
  ["action becomes an async function", p => { ${h}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useAction("", fresh());
  briefAction("", other());
}
actionInPlaces("", fresh);
actionInALoop("", () => {});
quiet = false;

useAction("untouched", fresh());

for (const [label, write] of actionWrites) {
  const first = fresh();
  write(first);
  useAction(label + ", a literal", first);
  const second = other();
  write(second);
  briefAction(label + ", a literal written backwards", second);
  actionInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  actionInALoop(label, write);
}

useAction("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `define-property-gives-a-number-member-of-a-literal-other-values.ts	Object.defineProperty(p, "count", { value: "text" }	Object.defineProperty(p, "count", { value: "12" }	Object.defineProperty(p, "count", { value: undefined }	Object.defineProperty(p, "count", { value: null }	Object.defineProperty(p, "count", { value: true }	Object.defineProperty(p, "count", { value: 1.5 }	Object.defineProperty(p, "count", { value: { valueOf: () => 42 }	Object.defineProperty(p, "count", { value: 10n }	Object.defineProperty(p, "count", { value: [7] }
object-assign-gives-a-number-member-of-a-literal-other-values.ts	Object.assign(p, { count: "text" }	Object.assign(p, { count: "12" }	Object.assign(p, { count: undefined }	Object.assign(p, { count: null }	Object.assign(p, { count: true }	Object.assign(p, { count: 1.5 }	Object.assign(p, { count: { valueOf: () => 42 }	Object.assign(p, { count: 10n }	Object.assign(p, { count: [7] }
reflect-set-gives-a-number-member-of-a-literal-other-values.ts	Reflect.set(p, "count", "text"	Reflect.set(p, "count", "12"	Reflect.set(p, "count", undefined	Reflect.set(p, "count", null	Reflect.set(p, "count", true	Reflect.set(p, "count", 1.5	Reflect.set(p, "count", { valueOf: () => 42	Reflect.set(p, "count", 10n	Reflect.set(p, "count", [7]`,
      (a, b, c, d, e, f, g, h, i) => `interface Inner {
  depth: number;
}

interface Part {
  count: number;
  label: string;
  inner: Inner;
  action: () => number;
  note?: string;
  readonly id: number;
  total(): number;
  title(): string;
}

function fresh(): Part {
  return {
    count: 1,
    label: "part",
    inner: { depth: 2 },
    action: () => 3,
    note: "note",
    id: 4,
    total() {
      return this.count + this.inner.depth + this.action() + this.id;
    },
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
  };
}

function other(): Part {
  return {
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
    total() {
      return this.count + this.inner.depth + this.action() + this.id + 5;
    },
    id: 4,
    note: "note",
    action: () => 3,
    inner: { depth: 2 },
    label: "part",
    count: 1,
  };
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function plusOne(p: Part): number {
  return p.count + 1;
}

function useCount(label: string, p: Part): void {
  attempt(label + ", read", () => p.count);
  attempt(label + ", typeof", () => typeof p.count);
  attempt(label + ", plus one", () => p.count + 1);
  attempt(label + ", doubled", () => p.count * 2);
  attempt(label + ", as an integer", () => p.count | 0);
  attempt(label + ", compared", () => p.count > 0);
  attempt(label + ", is undefined", () => p.count === undefined);
  attempt(label + ", is null or undefined", () => p.count == null);
  attempt(label + ", is a number", () => typeof p.count === "number");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.count === "number").length);
  attempt(label + ", a method of the number", () => p.count.toFixed(1));
  attempt(label + ", a typed function", () => plusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", incremented", () => ++p.count);
  attempt(label + ", stored", () => (p.count = 10));
  attempt(label + ", read after the store", () => p.count);
}

function briefCount(label: string, p: Part): void {
  attempt(label + ", used", () => p.count + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function countInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.count + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].count + 1);
  attempt(label + ", a result", () => make().count + 1);
}

function countInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.count + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const countWrites: [string, (p: Part) => void][] = [
  ["count becomes a string", p => { ${a}); }],
  ["count becomes a string of digits", p => { ${b}); }],
  ["count becomes undefined", p => { ${c}); }],
  ["count becomes null", p => { ${d}); }],
  ["count becomes true", p => { ${e}); }],
  ["count becomes a fraction", p => { ${f}); }],
  ["count becomes an object with valueOf", p => { ${g} }); }],
  ["count becomes a big integer", p => { ${h}); }],
  ["count becomes an array", p => { ${i}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useCount("", fresh());
  briefCount("", other());
}
countInPlaces("", fresh);
countInALoop("", () => {});
quiet = false;

useCount("untouched", fresh());

for (const [label, write] of countWrites) {
  const first = fresh();
  write(first);
  useCount(label + ", a literal", first);
  const second = other();
  write(second);
  briefCount(label + ", a literal written backwards", second);
  countInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  countInALoop(label, write);
}

useCount("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `define-property-gives-an-object-member-of-a-literal-other-values.ts	Object.defineProperty(p, "inner", { value: 5 }	Object.defineProperty(p, "inner", { value: "text" }	Object.defineProperty(p, "inner", { value: null }	Object.defineProperty(p, "inner", { value: undefined }	Object.defineProperty(p, "inner", { value: { deep: 1 }	Object.defineProperty(p, "inner", { value: { extra: 0, depth: 6 }	Object.defineProperty(p, "inner", { value: [1, 2] }	Object.defineProperty(p, "inner", { value: () => 1 }	Object.defineProperty(p, "inner", { value: { depth: "deep" }
object-assign-gives-an-object-member-of-a-literal-other-values.ts	Object.assign(p, { inner: 5 }	Object.assign(p, { inner: "text" }	Object.assign(p, { inner: null }	Object.assign(p, { inner: undefined }	Object.assign(p, { inner: { deep: 1 }	Object.assign(p, { inner: { extra: 0, depth: 6 }	Object.assign(p, { inner: [1, 2] }	Object.assign(p, { inner: () => 1 }	Object.assign(p, { inner: { depth: "deep" }
reflect-set-gives-an-object-member-of-a-literal-other-values.ts	Reflect.set(p, "inner", 5	Reflect.set(p, "inner", "text"	Reflect.set(p, "inner", null	Reflect.set(p, "inner", undefined	Reflect.set(p, "inner", { deep: 1	Reflect.set(p, "inner", { extra: 0, depth: 6	Reflect.set(p, "inner", [1, 2]	Reflect.set(p, "inner", () => 1	Reflect.set(p, "inner", { depth: "deep"`,
      (a, b, c, d, e, f, g, h, i) => `interface Inner {
  depth: number;
}

interface Part {
  count: number;
  label: string;
  inner: Inner;
  action: () => number;
  note?: string;
  readonly id: number;
  total(): number;
  title(): string;
}

function fresh(): Part {
  return {
    count: 1,
    label: "part",
    inner: { depth: 2 },
    action: () => 3,
    note: "note",
    id: 4,
    total() {
      return this.count + this.inner.depth + this.action() + this.id;
    },
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
  };
}

function other(): Part {
  return {
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
    total() {
      return this.count + this.inner.depth + this.action() + this.id + 5;
    },
    id: 4,
    note: "note",
    action: () => 3,
    inner: { depth: 2 },
    label: "part",
    count: 1,
  };
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function depthOf(p: Part): number {
  return p.inner.depth;
}

function useInner(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.inner);
  attempt(label + ", is undefined", () => p.inner === undefined);
  attempt(label + ", is null", () => p.inner === null);
  attempt(label + ", is truthy", () => !!p.inner);
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.inner === "object" && q.inner !== null).length);
  attempt(label + ", its member", () => p.inner.depth);
  attempt(label + ", its member plus one", () => p.inner.depth + 1);
  attempt(label + ", its keys", () => Object.keys(p.inner).join());
  attempt(label + ", a copy of it", () => JSON.stringify({ ...p.inner }));
  attempt(label + ", in", () => "depth" in p.inner);
  attempt(label + ", a pattern", () => (({ depth }: Inner) => depth)(p.inner));
  attempt(label + ", a typed function", () => depthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", its member stored", () => (p.inner.depth = 9));
  attempt(label + ", its member after the store", () => p.inner.depth);
  attempt(label + ", replaced", () => (p.inner = { depth: 8 }).depth);
  attempt(label + ", its member after that", () => p.inner.depth);
}

function briefInner(label: string, p: Part): void {
  attempt(label + ", used", () => p.inner.depth);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function innerInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.inner.depth);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].inner.depth);
  attempt(label + ", a result", () => make().inner.depth);
}

function innerInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.inner.depth;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const innerWrites: [string, (p: Part) => void][] = [
  ["inner becomes a number", p => { ${a}); }],
  ["inner becomes a string", p => { ${b}); }],
  ["inner becomes null", p => { ${c}); }],
  ["inner becomes undefined", p => { ${d}); }],
  ["inner becomes another shape", p => { ${e} }); }],
  ["inner becomes the member and more", p => { ${f} }); }],
  ["inner becomes an array", p => { ${g}); }],
  ["inner becomes a function", p => { ${h}); }],
  ["inner becomes a string under the member", p => { ${i} }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useInner("", fresh());
  briefInner("", other());
}
innerInPlaces("", fresh);
innerInALoop("", () => {});
quiet = false;

useInner("untouched", fresh());

for (const [label, write] of innerWrites) {
  const first = fresh();
  write(first);
  useInner(label + ", a literal", first);
  const second = other();
  write(second);
  briefInner(label + ", a literal written backwards", second);
  innerInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  innerInALoop(label, write);
}

useInner("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `a-bare-prototype-object-typed-as-a-point-in-every-place.ts	Object.create(Point.prototype, { x: { value: x, writable: true, enumerable: true, configurable: true } }
a-child-of-an-instance-typed-as-a-point-in-every-place.ts	Object.create(new Point(x, y)
a-proxy-typed-as-a-point-in-every-place.ts	new Proxy(new Point(x, y), {}
an-assigned-copy-typed-as-a-point-in-every-place.ts	Object.assign({}, new Point(x, y)`,
      a => `function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x: number;
  y: number;
  label = "point";
  visible = true;
  tags: string[] = ["first"];
  origin: { id: number } = { id: 7 };
  note?: string;
  #secret = 42;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
  secret(): number {
    return this.#secret;
  }
  static isPoint(value: object): boolean {
    return #secret in value;
  }
}

function make(x: number, y: number): Point {
  return ${a});
}

function inAParameter(p: Point): unknown {
  return [p.x + p.y, p.label.length];
}

function calledInAParameter(p: Point): number {
  return p.norm();
}

function inALocal(odd: boolean): unknown {
  const local: Point = odd ? make(3, 4) : new Point(3, 4);
  return [local.x + local.y, local.label.length];
}

function calledInALocal(odd: boolean): number {
  const local: Point = odd ? make(3, 4) : new Point(3, 4);
  return local.norm();
}

function asAResult(odd: boolean): Point {
  return odd ? make(3, 4) : new Point(3, 4);
}

class Holder {
  before = 1;
  point: Point;
  after = 2.5;
  constructor(point: Point) {
    this.point = point;
  }
  read(): unknown {
    return [this.before, this.point.x + this.point.y, this.point.label.length, this.after];
  }
  call(): number {
    return this.point.norm();
  }
  move(): number {
    this.point.x += 1;
    return this.point.x;
  }
}

function sumOfElements(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += points[i].x + points[i].y;
  return total;
}

function normsOfElements(points: Point[]): number[] {
  const norms: number[] = [];
  for (const point of points) norms.push(point.norm());
  return norms;
}

function captured(start: Point): { read(): number; call(): number; put(next: Point): void } {
  let held = start;
  return {
    read: () => held.x + held.y,
    call: () => held.norm(),
    put(next) {
      held = next;
    },
  };
}

function inAMap(points: Map<string, Point>, key: string): unknown {
  const point = points.get(key);
  return point === undefined ? "missing" : [point.x + point.y, typeof point.norm];
}

function orNothing(point: Point | null): number {
  return point === null ? -1 : point.x + point.y;
}

function generic<T extends Point>(point: T): number {
  return point.x + point.y;
}

function honestCallerOne(): unknown {
  return [inAParameter(new Point(1, 2)), calledInAParameter(new Point(3, 4))];
}
function honestCallerTwo(): unknown {
  const point = new Point(5, 12);
  return [inAParameter(point), calledInAParameter(point)];
}
function oddCaller(): unknown {
  return inAParameter(make(3, 4));
}
function oddCallerThatCalls(): number {
  return calledInAParameter(make(3, 4));
}

const table = { inAParameter, calledInAParameter };
const reusedHolder = new Holder(new Point(0, 0));
const reusedCapture = captured(new Point(0, 0));

attempt("the odd caller comes first", oddCaller);
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Point(i, 0.5);
  reusedHolder.point = honest;
  reusedCapture.put(honest);
  honestCallerOne();
  honestCallerTwo();
  inALocal(false);
  inAMap(new Map([["k", honest]]), "k");
  warm += calledInALocal(false) + asAResult(false).x + reusedHolder.call() + reusedHolder.move() + new Holder(honest).call() + sumOfElements([honest, honest]) + normsOfElements([honest]).length;
  warm += reusedCapture.read() + reusedCapture.call() + orNothing(honest) + orNothing(null) + generic(honest);
}
console.log("after 2000 honest points", warm);

attempt("a parameter", oddCaller);
attempt("a parameter, called", oddCallerThatCalls);
attempt("a local", () => inALocal(true));
attempt("a local, called", () => calledInALocal(true));
attempt("a result", () => [asAResult(true).x + asAResult(true).y, typeof asAResult(true).norm]);
attempt("a result, called", () => asAResult(true).norm());
attempt("a field of a new object", () => new Holder(make(3, 4)).read());
attempt("a field of a new object, called", () => new Holder(make(3, 4)).call());
attempt("a field of a new object, stored through", () => new Holder(make(3, 4)).move());
attempt("a field of an old object", () => {
  reusedHolder.point = make(3, 4);
  return [reusedHolder.read(), reusedHolder.move()];
});
attempt("a field of an old object, called", () => reusedHolder.call());
attempt("elements", () => sumOfElements([new Point(1, 1), make(3, 4), new Point(1, 1)]));
attempt("elements, called", () => normsOfElements([new Point(3, 4), make(3, 4), new Point(3, 4)]));
attempt("one among 3000 elements", () => {
  const points: Point[] = [];
  for (let i = 0; i < 3000; i++) points.push(i === 1500 ? make(3, 4) : new Point(1, 1));
  return sumOfElements(points);
});
attempt("a captured variable", () => {
  reusedCapture.put(make(3, 4));
  return [reusedCapture.read(), captured(make(3, 4)).read()];
});
attempt("a captured variable, called", () => reusedCapture.call());
attempt("a map value", () => inAMap(new Map([["k", make(3, 4)]]), "k"));
attempt("beside null", () => orNothing(make(3, 4)));
attempt("a generic", () => generic(make(3, 4)));
attempt("call, apply, bind", () => [inAParameter.call(undefined, make(3, 4)), inAParameter.apply(undefined, [make(3, 4)]), inAParameter.bind(undefined, make(3, 4))()]);
attempt("handed to map", () => [new Point(1, 2), make(3, 4), new Point(5, 6)].map(inAParameter));
attempt("handed to map, called", () => [new Point(3, 4), make(3, 4)].map(calledInAParameter));
attempt("read from a literal", () => table.inAParameter(make(3, 4)));
attempt("sorted with honest points", () => [new Point(9, 9), make(3, 4), new Point(1, 1)].toSorted((a, b) => a.x - b.x).map(point => point.x));
attempt("honest again", () => [honestCallerOne(), honestCallerTwo(), new Holder(new Point(3, 4)).call()]);
`,
    ),
    ...family(
      `a-parsed-copy-typed-as-a-point-in-every-place.ts	JSON.parse(JSON.stringify(new Point(x, y)
a-revoked-proxy-typed-as-a-point-in-every-place.ts	((pair: { proxy: Point; revoke: () => void }) => (pair.revoke(), pair.proxy))(Proxy.revocable(new Point(x, y), {}
a-structured-clone-typed-as-a-point-in-every-place.ts	structuredClone(new Point(x, y`,
      a => `function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x: number;
  y: number;
  label = "point";
  visible = true;
  tags: string[] = ["first"];
  origin: { id: number } = { id: 7 };
  note?: string;
  #secret = 42;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
  secret(): number {
    return this.#secret;
  }
  static isPoint(value: object): boolean {
    return #secret in value;
  }
}

function make(x: number, y: number): Point {
  return ${a}));
}

function inAParameter(p: Point): unknown {
  return [p.x + p.y, p.label.length];
}

function calledInAParameter(p: Point): number {
  return p.norm();
}

function inALocal(odd: boolean): unknown {
  const local: Point = odd ? make(3, 4) : new Point(3, 4);
  return [local.x + local.y, local.label.length];
}

function calledInALocal(odd: boolean): number {
  const local: Point = odd ? make(3, 4) : new Point(3, 4);
  return local.norm();
}

function asAResult(odd: boolean): Point {
  return odd ? make(3, 4) : new Point(3, 4);
}

class Holder {
  before = 1;
  point: Point;
  after = 2.5;
  constructor(point: Point) {
    this.point = point;
  }
  read(): unknown {
    return [this.before, this.point.x + this.point.y, this.point.label.length, this.after];
  }
  call(): number {
    return this.point.norm();
  }
  move(): number {
    this.point.x += 1;
    return this.point.x;
  }
}

function sumOfElements(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += points[i].x + points[i].y;
  return total;
}

function normsOfElements(points: Point[]): number[] {
  const norms: number[] = [];
  for (const point of points) norms.push(point.norm());
  return norms;
}

function captured(start: Point): { read(): number; call(): number; put(next: Point): void } {
  let held = start;
  return {
    read: () => held.x + held.y,
    call: () => held.norm(),
    put(next) {
      held = next;
    },
  };
}

function inAMap(points: Map<string, Point>, key: string): unknown {
  const point = points.get(key);
  return point === undefined ? "missing" : [point.x + point.y, typeof point.norm];
}

function orNothing(point: Point | null): number {
  return point === null ? -1 : point.x + point.y;
}

function generic<T extends Point>(point: T): number {
  return point.x + point.y;
}

function honestCallerOne(): unknown {
  return [inAParameter(new Point(1, 2)), calledInAParameter(new Point(3, 4))];
}
function honestCallerTwo(): unknown {
  const point = new Point(5, 12);
  return [inAParameter(point), calledInAParameter(point)];
}
function oddCaller(): unknown {
  return inAParameter(make(3, 4));
}
function oddCallerThatCalls(): number {
  return calledInAParameter(make(3, 4));
}

const table = { inAParameter, calledInAParameter };
const reusedHolder = new Holder(new Point(0, 0));
const reusedCapture = captured(new Point(0, 0));

attempt("the odd caller comes first", oddCaller);
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Point(i, 0.5);
  reusedHolder.point = honest;
  reusedCapture.put(honest);
  honestCallerOne();
  honestCallerTwo();
  inALocal(false);
  inAMap(new Map([["k", honest]]), "k");
  warm += calledInALocal(false) + asAResult(false).x + reusedHolder.call() + reusedHolder.move() + new Holder(honest).call() + sumOfElements([honest, honest]) + normsOfElements([honest]).length;
  warm += reusedCapture.read() + reusedCapture.call() + orNothing(honest) + orNothing(null) + generic(honest);
}
console.log("after 2000 honest points", warm);

attempt("a parameter", oddCaller);
attempt("a parameter, called", oddCallerThatCalls);
attempt("a local", () => inALocal(true));
attempt("a local, called", () => calledInALocal(true));
attempt("a result", () => [asAResult(true).x + asAResult(true).y, typeof asAResult(true).norm]);
attempt("a result, called", () => asAResult(true).norm());
attempt("a field of a new object", () => new Holder(make(3, 4)).read());
attempt("a field of a new object, called", () => new Holder(make(3, 4)).call());
attempt("a field of a new object, stored through", () => new Holder(make(3, 4)).move());
attempt("a field of an old object", () => {
  reusedHolder.point = make(3, 4);
  return [reusedHolder.read(), reusedHolder.move()];
});
attempt("a field of an old object, called", () => reusedHolder.call());
attempt("elements", () => sumOfElements([new Point(1, 1), make(3, 4), new Point(1, 1)]));
attempt("elements, called", () => normsOfElements([new Point(3, 4), make(3, 4), new Point(3, 4)]));
attempt("one among 3000 elements", () => {
  const points: Point[] = [];
  for (let i = 0; i < 3000; i++) points.push(i === 1500 ? make(3, 4) : new Point(1, 1));
  return sumOfElements(points);
});
attempt("a captured variable", () => {
  reusedCapture.put(make(3, 4));
  return [reusedCapture.read(), captured(make(3, 4)).read()];
});
attempt("a captured variable, called", () => reusedCapture.call());
attempt("a map value", () => inAMap(new Map([["k", make(3, 4)]]), "k"));
attempt("beside null", () => orNothing(make(3, 4)));
attempt("a generic", () => generic(make(3, 4)));
attempt("call, apply, bind", () => [inAParameter.call(undefined, make(3, 4)), inAParameter.apply(undefined, [make(3, 4)]), inAParameter.bind(undefined, make(3, 4))()]);
attempt("handed to map", () => [new Point(1, 2), make(3, 4), new Point(5, 6)].map(inAParameter));
attempt("handed to map, called", () => [new Point(3, 4), make(3, 4)].map(calledInAParameter));
attempt("read from a literal", () => table.inAParameter(make(3, 4)));
attempt("sorted with honest points", () => [new Point(9, 9), make(3, 4), new Point(1, 1)].toSorted((a, b) => a.x - b.x).map(point => point.x));
attempt("honest again", () => [honestCallerOne(), honestCallerTwo(), new Holder(new Point(3, 4)).call()]);
`,
    ),
    ...family(
      `define-property-gives-the-elements-of-arrays-and-tuples-other-values.ts	Object.defineProperty(list, 0, { value: "text" }	Object.defineProperty(list, 1, { value: undefined }	Object.defineProperty(list, 0, { value: null }	Object.defineProperty(list, 0, { value: 1.5 }	Object.defineProperty(list, 0, { value: 4294967296 }	Object.defineProperty(list, 0, { value: { valueOf: () => 42 }	Object.defineProperty(list, 6, { value: 7 }	Object.defineProperty(list, "length", { value: 1 }	Object.defineProperty(list, "length", { value: 5 }	Object.defineProperty(list, "note", { value: "n" }	Object.defineProperty(p, 0, { value: "text" }	Object.defineProperty(p, 1, { value: 7 }	Object.defineProperty(p, 2, { value: true }	Object.defineProperty(p, "length", { value: 1 }	Object.defineProperty(list, 0, { value: 5 }	Object.defineProperty(list, 0, { value: { deep: 1 }
object-assign-gives-the-elements-of-arrays-and-tuples-other-values.ts	Object.assign(list, { 0: "text" }	Object.assign(list, { 1: undefined }	Object.assign(list, { 0: null }	Object.assign(list, { 0: 1.5 }	Object.assign(list, { 0: 4294967296 }	Object.assign(list, { 0: { valueOf: () => 42 }	Object.assign(list, { 6: 7 }	Object.assign(list, { length: 1 }	Object.assign(list, { length: 5 }	Object.assign(list, { note: "n" }	Object.assign(p, { 0: "text" }	Object.assign(p, { 1: 7 }	Object.assign(p, { 2: true }	Object.assign(p, { length: 1 }	Object.assign(list, { 0: 5 }	Object.assign(list, { 0: { deep: 1 }
reflect-set-gives-the-elements-of-arrays-and-tuples-other-values.ts	Reflect.set(list, 0, "text"	Reflect.set(list, 1, undefined	Reflect.set(list, 0, null	Reflect.set(list, 0, 1.5	Reflect.set(list, 0, 4294967296	Reflect.set(list, 0, { valueOf: () => 42	Reflect.set(list, 6, 7	Reflect.set(list, "length", 1	Reflect.set(list, "length", 5	Reflect.set(list, "note", "n"	Reflect.set(p, 0, "text"	Reflect.set(p, 1, 7	Reflect.set(p, 2, true	Reflect.set(p, "length", 1	Reflect.set(list, 0, 5	Reflect.set(list, 0, { deep: 1`,
      (a, b, c, d, e, f, g, h, i, j, k, l, m, o, p, q) => `interface Inner {
  depth: number;
}

function numbers(): number[] {
  return [1, 2, 3];
}

function pair(): [number, string] {
  return [1, "one"];
}

function parts(): Inner[] {
  return [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
}

function sum(list: number[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function sumOf(list: number[]): number {
  let total = 0;
  for (const n of list) total += n;
  return total;
}

function depths(list: Inner[]): number {
  let total = 0;
  for (const part of list) total += part.depth;
  return total;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;
}

function useNumbers(label: string, list: number[]): void {
  attempt(label + ", the first", () => list[0]);
  attempt(label + ", typeof the first", () => typeof list[0]);
  attempt(label + ", the first plus one", () => list[0] + 1);
  attempt(label + ", the second doubled", () => list[1] * 2);
  attempt(label + ", its length", () => list.length);
  attempt(label + ", summed by index", () => sum(list));
  attempt(label + ", summed by for-of", () => sumOf(list));
  attempt(label + ", reduced", () => list.reduce((a, b) => a + b, 0));
  attempt(label + ", mapped", () => list.map(n => n + 1).join());
  attempt(label + ", joined", () => list.join());
  attempt(label + ", json", () => JSON.stringify(list));
  attempt(label + ", spread", () => JSON.stringify([...list]));
  attempt(label + ", keys", () => Object.keys(list).join());
  attempt(label + ", has the second", () => 1 in list);
  attempt(label + ", index of 2", () => list.indexOf(2));
  attempt(label + ", a callback finds undefined", () => list.findIndex(n => n === undefined));
  attempt(label + ", a callback counts numbers", () => list.filter(n => typeof n === "number").length);
  attempt(label + ", kinds", () => list.map(n => typeof n).join());
  attempt(label + ", the first is undefined", () => list[0] === undefined);
  attempt(label + ", the second is a number", () => typeof list[1] === "number");
  attempt(label + ", a pattern", () => (([a, b]: number[]) => a + b)(list));
  attempt(label + ", the largest", () => Math.max(...list));
  attempt(label + ", is an array", () => Array.isArray(list) + " " + (list instanceof Array));
  attempt(label + ", the first stored", () => (list[0] = 10));
  attempt(label + ", the first after the store", () => list[0]);
  attempt(label + ", pushed", () => list.push(4));
  attempt(label + ", popped", () => list.pop());
  attempt(label + ", shortened", () => (list.length = 1));
  attempt(label + ", json after all that", () => JSON.stringify(list));
}

function usePair(label: string, p: [number, string]): void {
  attempt(label + ", the number plus one", () => p[0] + 1);
  attempt(label + ", the length of the string", () => p[1].length);
  attempt(label + ", its length", () => p.length);
  attempt(label + ", a pattern", () => (([n, s]: [number, string]) => s + n)(p));
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", the number stored", () => (p[0] = 10));
  attempt(label + ", the string stored", () => (p[1] = "ten"));
  attempt(label + ", json after the stores", () => JSON.stringify(p));
}

function useParts(label: string, list: Inner[]): void {
  attempt(label + ", the depth of the first", () => list[0].depth);
  attempt(label + ", a callback finds what is no object", () => list.findIndex(part => typeof part !== "object" || part === null));
  attempt(label + ", the first is undefined", () => list[0] === undefined);
  attempt(label + ", all depths", () => depths(list));
  attempt(label + ", json", () => JSON.stringify(list));
}

class Holder {
  list: number[];
  constructor(list: number[]) {
    this.list = list;
  }
}

function inPlaces(label: string, make: () => number[]): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.list[0] + holder.list.length);
  const lists: number[][] = [numbers(), make()];
  attempt(label + ", an element", () => lists[1][0] + lists[1].length);
  attempt(label + ", a result", () => make()[0] + make().length);
}

function inALoop(label: string, write: (list: number[]) => void): void {
  const list = numbers();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(list);
      const value = list[0] + list[1] + list.length;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

const numberWrites: [string, (list: number[]) => void][] = [
  ["the first becomes a string", list => { ${a}); }],
  ["the second becomes undefined", list => { ${b}); }],
  ["the first becomes null", list => { ${c}); }],
  ["the first becomes a fraction", list => { ${d}); }],
  ["the first becomes a large number", list => { ${e}); }],
  ["the first becomes an object with valueOf", list => { ${f} }); }],
  ["an element far behind the end", list => { ${g}); }],
  ["the length becomes one", list => { ${h}); }],
  ["the length becomes five", list => { ${i}); }],
  ["a named member is added", list => { ${j}); }],
];

const pairWrites: [string, (p: [number, string]) => void][] = [
  ["the number becomes a string", p => { ${k}); }],
  ["the string becomes a number", p => { ${l}); }],
  ["a third element", p => { ${m}); }],
  ["the length becomes one", p => { ${o}); }],
];

const partsWrites: [string, (list: Inner[]) => void][] = [
  ["the first becomes a number", list => { ${p}); }],
  ["the first becomes null", list => { ${c}); }],
  ["the first becomes another shape", list => { ${q} }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useNumbers("", numbers());
  usePair("", pair());
  useParts("", parts());
}
inPlaces("", numbers);
inALoop("", () => {});
quiet = false;

useNumbers("untouched", numbers());
usePair("untouched", pair());
useParts("untouched", parts());

for (const [label, write] of numberWrites) {
  const list = numbers();
  attempt(label + ", the write itself", () => write(list));
  useNumbers(label, list);
  inPlaces(label, () => {
    const made = numbers();
    write(made);
    return made;
  });
  inALoop(label, write);
}

for (const [label, write] of pairWrites) {
  const p = pair();
  attempt(label + ", the write itself", () => write(p));
  usePair(label, p);
}

for (const [label, write] of partsWrites) {
  const list = parts();
  attempt(label + ", the write itself", () => write(list));
  useParts(label, list);
}

useNumbers("untouched afterwards", numbers());

export {};
`,
    ),
    ...family(
      `define-property-gives-optional-and-readonly-fields-of-an-instance-other-values.ts	Object.defineProperty(p, "note", { value: 5 }	Object.defineProperty(p, "note", { value: null }	Object.defineProperty(p, "note", { value: undefined }	Object.defineProperty(p, "note", { value: { length: 1 }	Object.defineProperty(p, "id", { value: "text" }	Object.defineProperty(p, "id", { value: 9 }	Object.defineProperty(p, "id", { value: undefined }	Object.defineProperty(p, "id", { value: 0.5 }
object-assign-gives-optional-and-readonly-fields-of-an-instance-other-values.ts	Object.assign(p, { note: 5 }	Object.assign(p, { note: null }	Object.assign(p, { note: undefined }	Object.assign(p, { note: { length: 1 }	Object.assign(p, { id: "text" }	Object.assign(p, { id: 9 }	Object.assign(p, { id: undefined }	Object.assign(p, { id: 0.5 }
reflect-set-gives-optional-and-readonly-fields-of-an-instance-other-values.ts	Reflect.set(p, "note", 5	Reflect.set(p, "note", null	Reflect.set(p, "note", undefined	Reflect.set(p, "note", { length: 1	Reflect.set(p, "id", "text"	Reflect.set(p, "id", 9	Reflect.set(p, "id", undefined	Reflect.set(p, "id", 0.5`,
      (a, b, c, d, e, f, g, h) => `interface Inner {
  depth: number;
}

class Part {
  count = 1;
  label = "part";
  inner: Inner = { depth: 2 };
  action: () => number = () => 3;
  note?: string = "note";
  readonly id: number = 4;
  total(): number {
    return this.count + this.inner.depth + this.action() + this.id;
  }
  title(): string {
    return this.label + ":" + (this.note ?? "none");
  }
}

class SubPart extends Part {
  extra = 5;
  total(): number {
    return super.total() + this.extra;
  }
}

function fresh(): Part {
  return new Part();
}

function other(): Part {
  return new SubPart();
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function noteOf(p: Part): string {
  return p.note ?? "none";
}

function useNote(label: string, p: Part): void {
  attempt(label + ", read", () => p.note);
  attempt(label + ", typeof", () => typeof p.note);
  attempt(label + ", is undefined", () => p.note === undefined);
  attempt(label + ", is a string", () => typeof p.note === "string");
  attempt(label + ", or a default", () => p.note ?? "none");
  attempt(label + ", its length", () => p.note?.length);
  attempt(label + ", in", () => "note" in p);
  attempt(label + ", a typed function", () => noteOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", stored", () => (p.note = "stored"));
  attempt(label + ", read after the store", () => p.note);
  attempt(label + ", deleted", () => delete p.note);
  attempt(label + ", read after the delete", () => p.note);
}

function briefNote(label: string, p: Part): void {
  attempt(label + ", used", () => (p.note ?? "none"));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function noteInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => (holder.part.note ?? "none"));
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => (list[1].note ?? "none"));
  attempt(label + ", a result", () => (make().note ?? "none"));
}

function noteInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = (p.note ?? "none");
      if (typeof value === "string") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function idPlusOne(p: Part): number {
  return p.id + 1;
}

function useId(label: string, p: Part): void {
  attempt(label + ", read", () => p.id);
  attempt(label + ", typeof", () => typeof p.id);
  attempt(label + ", is undefined", () => p.id === undefined);
  attempt(label + ", is a number", () => typeof p.id === "number");
  attempt(label + ", plus one", () => p.id + 1);
  attempt(label + ", as an integer", () => p.id | 0);
  attempt(label + ", a typed function", () => idPlusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
}

function briefId(label: string, p: Part): void {
  attempt(label + ", used", () => p.id + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function idInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.id + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].id + 1);
  attempt(label + ", a result", () => make().id + 1);
}

function idInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.id + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const noteWrites: [string, (p: Part) => void][] = [
  ["note becomes a number", p => { ${a}); }],
  ["note becomes null", p => { ${b}); }],
  ["note becomes undefined", p => { ${c}); }],
  ["note becomes an object with a length", p => { ${d} }); }],
];

const idWrites: [string, (p: Part) => void][] = [
  ["id becomes a string", p => { ${e}); }],
  ["id becomes another number", p => { ${f}); }],
  ["id becomes undefined", p => { ${g}); }],
  ["id becomes a fraction", p => { ${h}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useNote("", fresh());
  briefNote("", other());
  useId("", fresh());
  briefId("", other());
}
noteInPlaces("", fresh);
noteInALoop("", () => {});
idInPlaces("", fresh);
idInALoop("", () => {});
quiet = false;

useNote("untouched", fresh());

for (const [label, write] of noteWrites) {
  const first = fresh();
  write(first);
  useNote(label + ", an instance", first);
  const second = other();
  write(second);
  briefNote(label + ", a subclass instance", second);
  noteInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  noteInALoop(label, write);
}

useNote("untouched afterwards", fresh());

useId("untouched", fresh());

for (const [label, write] of idWrites) {
  const first = fresh();
  write(first);
  useId(label + ", an instance", first);
  const second = other();
  write(second);
  briefId(label + ", a subclass instance", second);
  idInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  idInALoop(label, write);
}

useId("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `define-property-puts-a-getter-of-another-kind-inside-the-loop-that-uses-it.ts	Object.defineProperty(o, "value", { get: () => "text", enumerable: true, configurable: true }	Object.defineProperty(o, "value", { get: () => 7, enumerable: true, configurable: true }	Object.defineProperty(o, "value", { get: () => 5, enumerable: true, configurable: true }	Object.defineProperty(o, "value5", { get: () => "text", enumerable: true, configurable: true }	Object.defineProperty(C6.prototype, "value", { get: () => 5, enumerable: true, configurable: true }	Object.defineProperty(C7, "value", { get: () => "text", enumerable: true, configurable: true }
object-assign-puts-undefined-inside-the-loop-that-uses-it.ts	Object.assign(o, { value: undefined }	Object.assign(o, { value: undefined }	Object.assign(o, { value: undefined }	Object.assign(o, { value5: undefined }	Object.assign(C6.prototype, { value: undefined }	Object.assign(C7, { value: undefined }
reflect-delete-property-removes-the-member-inside-the-loop-that-uses-it.ts	Reflect.deleteProperty(o, "value"	Reflect.deleteProperty(o, "value"	Reflect.deleteProperty(o, "value"	Reflect.deleteProperty(o, "value5"	Reflect.deleteProperty(C6.prototype, "value"	Reflect.deleteProperty(C7, "value"
reflect-set-puts-a-value-of-another-kind-inside-the-loop-that-uses-it.ts	Reflect.set(o, "value", "text"	Reflect.set(o, "value", 7	Reflect.set(o, "value", 5	Reflect.set(o, "value5", "text"	Reflect.set(C6.prototype, "value", 5	Reflect.set(C7, "value", "text"`,
      (a, b, c, d, e, f) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  value = 1;
}

attempt("a number field, used", () => {
  const o = new C1();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${a});
      if (o.value + 1 === 2) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a number field, asked for its kind", () => {
  const o = new C1();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${a});
      if (typeof o.value === "number") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C2 {
  value = "s";
}

attempt("a string field, used", () => {
  const o = new C2();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${b});
      if (o.value.length === 1) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a string field, asked for its kind", () => {
  const o = new C2();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${b});
      if (typeof o.value === "string") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C3 {
  value = { depth: 1 };
}

attempt("an object field, used", () => {
  const o = new C3();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${c});
      if (o.value.depth === 1) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("an object field, asked for its kind", () => {
  const o = new C3();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${c});
      if (typeof o.value === "object") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C4 {
  value: () => number = () => 1;
}

attempt("a function field, used", () => {
  const o = new C4();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${c});
      if (o.value() === 1) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a function field, asked for its kind", () => {
  const o = new C4();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${c});
      if (typeof o.value === "function") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

interface C5 {
  value5: number;
}

attempt("a member of a literal, used", () => {
  const o: C5 = { value5: 1 };
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${d});
      if (o.value5 + 1 === 2) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a member of a literal, asked for its kind", () => {
  const o: C5 = { value5: 1 };
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${d});
      if (typeof o.value5 === "number") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C6 {
  value(): number {
    return 1;
  }
}

attempt("a method of a prototype, used", () => {
  const o = new C6();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${e});
      if (o.value() === 1) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C7 {
  static value = 1;
}

attempt("a static field, used", () => {
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${f});
      if (C7.value + 1 === 2) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C8 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

attempt("a field read by a method, used", () => {
  const o = new C8();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${a});
      if (o.twice() === 2) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a field read by a method, asked for its kind", () => {
  const o = new C8();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${a});
      if (typeof o.twice() === "number") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

export {};
`,
    ),
    ...family(
      `reflect-delete-property-removes-a-number-field-through-other-holders-and-in-odd-corners.ts	deleteProperty(list[0], "value"	deleteProperty(target, "value"	deleteProperty(holder.held, "value"	deleteProperty(o, "value"
reflect-set-puts-a-string-into-a-number-field-through-other-holders-and-in-odd-corners.ts	set(list[0], "value", "text"	set(target, "value", "text"	set(holder.held, "value", "text"	set(o, "value", "text"
reflect-set-puts-undefined-into-a-number-field-through-other-holders-and-in-odd-corners.ts	set(list[0], "value", undefined	set(target, "value", undefined	set(holder.held, "value", undefined	set(o, "value", undefined`,
      (a, b, c, d) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  const list: C1[] = [o];
  Reflect.${a});
  attempt("written through an element of a list, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written through an element of a list, asked by a typed function", () => ask1(o));
  attempt("written through an element of a list, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written through an element of a list, used", () => o.value + 1);
  attempt("written through an element of a list, by its own method", () => o.twice());
}

block1();

class C2 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  const map = new Map<string, C2>([["k", o]]);
  for (const target of map.values()) {
    Reflect.${b});
  }
  attempt("written through a value of a map, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written through a value of a map, asked by a typed function", () => ask2(o));
  attempt("written through a value of a map, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written through a value of a map, used", () => o.value + 1);
  attempt("written through a value of a map, by its own method", () => o.twice());
}

block2();

class C3 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class H3 {
  constructor(public held: C3) {}
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  const holder = new H3(o);
  Reflect.${c});
  attempt("written through a field of a holder, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written through a field of a holder, asked by a typed function", () => ask3(o));
  attempt("written through a field of a holder, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written through a field of a holder, used", () => o.value + 1);
  attempt("written through a field of a holder, by its own method", () => o.twice());
}

block3();

class C4 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  for (const target of Object.values({ o })) {
    Reflect.${b});
  }
  attempt("written through what Object.values gives, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written through what Object.values gives, asked by a typed function", () => ask4(o));
  attempt("written through what Object.values gives, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written through what Object.values gives, used", () => o.value + 1);
  attempt("written through what Object.values gives, by its own method", () => o.twice());
}

block4();

class C5 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  const spoil = () => {
    Reflect.${d});
  };
  spoil();
  attempt("written by a closure made earlier, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a closure made earlier, asked by a typed function", () => ask5(o));
  attempt("written by a closure made earlier, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a closure made earlier, used", () => o.value + 1);
  attempt("written by a closure made earlier, by its own method", () => o.twice());
}

block5();

class C6 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask6(o: C6): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block6(): void {
  const o = new C6();
  ((ignored = (() => {
    Reflect.${d});
    return 0;
  })()) => ignored)();
  attempt("written by a default parameter, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a default parameter, asked by a typed function", () => ask6(o));
  attempt("written by a default parameter, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a default parameter, used", () => o.value + 1);
  attempt("written by a default parameter, by its own method", () => o.twice());
}

block6();

class C7 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask7(o: C7): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block7(): void {
  const o = new C7();
  ({
    [(() => {
      Reflect.${d});
      return "k";
    })()]: 1,
  });
  attempt("written while a key is computed, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written while a key is computed, asked by a typed function", () => ask7(o));
  attempt("written while a key is computed, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written while a key is computed, used", () => o.value + 1);
  attempt("written while a key is computed, by its own method", () => o.twice());
}

block7();

class C8 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask8(o: C8): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block8(): void {
  const o = new C8();
  [2, 1].toSorted((a, b) => {
    Reflect.${d});
    return a - b;
  });
  attempt("written by a comparator, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a comparator, asked by a typed function", () => ask8(o));
  attempt("written by a comparator, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a comparator, used", () => o.value + 1);
  attempt("written by a comparator, by its own method", () => o.twice());
}

block8();

class C9 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask9(o: C9): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block9(): void {
  const o = new C9();
  JSON.stringify({ a: 1 }, (key, value: unknown) => {
    Reflect.${d});
    return value;
  });
  attempt("written by a replacer of JSON.stringify, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a replacer of JSON.stringify, asked by a typed function", () => ask9(o));
  attempt("written by a replacer of JSON.stringify, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a replacer of JSON.stringify, used", () => o.value + 1);
  attempt("written by a replacer of JSON.stringify, by its own method", () => o.twice());
}

block9();

export {};
`,
    ),
    ...family(
      `define-property-gives-optional-and-readonly-members-of-a-literal-other-values.ts	Object.defineProperty(p, "note", { value: 5 }	Object.defineProperty(p, "note", { value: null }	Object.defineProperty(p, "note", { value: undefined }	Object.defineProperty(p, "note", { value: { length: 1 }	Object.defineProperty(p, "id", { value: "text" }	Object.defineProperty(p, "id", { value: 9 }	Object.defineProperty(p, "id", { value: undefined }	Object.defineProperty(p, "id", { value: 0.5 }
object-assign-gives-optional-and-readonly-members-of-a-literal-other-values.ts	Object.assign(p, { note: 5 }	Object.assign(p, { note: null }	Object.assign(p, { note: undefined }	Object.assign(p, { note: { length: 1 }	Object.assign(p, { id: "text" }	Object.assign(p, { id: 9 }	Object.assign(p, { id: undefined }	Object.assign(p, { id: 0.5 }
reflect-set-gives-optional-and-readonly-members-of-a-literal-other-values.ts	Reflect.set(p, "note", 5	Reflect.set(p, "note", null	Reflect.set(p, "note", undefined	Reflect.set(p, "note", { length: 1	Reflect.set(p, "id", "text"	Reflect.set(p, "id", 9	Reflect.set(p, "id", undefined	Reflect.set(p, "id", 0.5`,
      (a, b, c, d, e, f, g, h) => `interface Inner {
  depth: number;
}

interface Part {
  count: number;
  label: string;
  inner: Inner;
  action: () => number;
  note?: string;
  readonly id: number;
  total(): number;
  title(): string;
}

function fresh(): Part {
  return {
    count: 1,
    label: "part",
    inner: { depth: 2 },
    action: () => 3,
    note: "note",
    id: 4,
    total() {
      return this.count + this.inner.depth + this.action() + this.id;
    },
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
  };
}

function other(): Part {
  return {
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
    total() {
      return this.count + this.inner.depth + this.action() + this.id + 5;
    },
    id: 4,
    note: "note",
    action: () => 3,
    inner: { depth: 2 },
    label: "part",
    count: 1,
  };
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function noteOf(p: Part): string {
  return p.note ?? "none";
}

function useNote(label: string, p: Part): void {
  attempt(label + ", read", () => p.note);
  attempt(label + ", typeof", () => typeof p.note);
  attempt(label + ", is undefined", () => p.note === undefined);
  attempt(label + ", is a string", () => typeof p.note === "string");
  attempt(label + ", or a default", () => p.note ?? "none");
  attempt(label + ", its length", () => p.note?.length);
  attempt(label + ", in", () => "note" in p);
  attempt(label + ", a typed function", () => noteOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", stored", () => (p.note = "stored"));
  attempt(label + ", read after the store", () => p.note);
  attempt(label + ", deleted", () => delete p.note);
  attempt(label + ", read after the delete", () => p.note);
}

function briefNote(label: string, p: Part): void {
  attempt(label + ", used", () => (p.note ?? "none"));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function noteInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => (holder.part.note ?? "none"));
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => (list[1].note ?? "none"));
  attempt(label + ", a result", () => (make().note ?? "none"));
}

function noteInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = (p.note ?? "none");
      if (typeof value === "string") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function idPlusOne(p: Part): number {
  return p.id + 1;
}

function useId(label: string, p: Part): void {
  attempt(label + ", read", () => p.id);
  attempt(label + ", typeof", () => typeof p.id);
  attempt(label + ", is undefined", () => p.id === undefined);
  attempt(label + ", is a number", () => typeof p.id === "number");
  attempt(label + ", plus one", () => p.id + 1);
  attempt(label + ", as an integer", () => p.id | 0);
  attempt(label + ", a typed function", () => idPlusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
}

function briefId(label: string, p: Part): void {
  attempt(label + ", used", () => p.id + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function idInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.id + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].id + 1);
  attempt(label + ", a result", () => make().id + 1);
}

function idInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.id + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const noteWrites: [string, (p: Part) => void][] = [
  ["note becomes a number", p => { ${a}); }],
  ["note becomes null", p => { ${b}); }],
  ["note becomes undefined", p => { ${c}); }],
  ["note becomes an object with a length", p => { ${d} }); }],
];

const idWrites: [string, (p: Part) => void][] = [
  ["id becomes a string", p => { ${e}); }],
  ["id becomes another number", p => { ${f}); }],
  ["id becomes undefined", p => { ${g}); }],
  ["id becomes a fraction", p => { ${h}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useNote("", fresh());
  briefNote("", other());
  useId("", fresh());
  briefId("", other());
}
noteInPlaces("", fresh);
noteInALoop("", () => {});
idInPlaces("", fresh);
idInALoop("", () => {});
quiet = false;

useNote("untouched", fresh());

for (const [label, write] of noteWrites) {
  const first = fresh();
  write(first);
  useNote(label + ", a literal", first);
  const second = other();
  write(second);
  briefNote(label + ", a literal written backwards", second);
  noteInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  noteInALoop(label, write);
}

useNote("untouched afterwards", fresh());

useId("untouched", fresh());

for (const [label, write] of idWrites) {
  const first = fresh();
  write(first);
  useId(label + ", a literal", first);
  const second = other();
  write(second);
  briefId(label + ", a literal written backwards", second);
  idInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  idInALoop(label, write);
}

useId("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `reflect-delete-property-removes-a-number-field-in-callees-callbacks-and-conversions.ts	deleteProperty(target, "value"	deleteProperty(o, "value"
reflect-set-puts-a-string-into-a-number-field-in-callees-callbacks-and-conversions.ts	set(target, "value", "text"	set(o, "value", "text"
reflect-set-puts-undefined-into-a-number-field-in-callees-callbacks-and-conversions.ts	set(target, "value", undefined	set(o, "value", undefined`,
      (a, b) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function write1(target: C1): void {
  Reflect.${a});
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  write1(o);
  attempt("written by a callee that takes its type, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a callee that takes its type, asked by a typed function", () => ask1(o));
  attempt("written by a callee that takes its type, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a callee that takes its type, used", () => o.value + 1);
  attempt("written by a callee that takes its type, by its own method", () => o.twice());
}

block1();

class C2 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function write2(target: object): void {
  Reflect.${a});
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  write2(o);
  attempt("written by a callee that takes any object, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a callee that takes any object, asked by a typed function", () => ask2(o));
  attempt("written by a callee that takes any object, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a callee that takes any object, used", () => o.value + 1);
  attempt("written by a callee that takes any object, by its own method", () => o.twice());
}

block2();

class C3 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  [o].forEach(target => {
    Reflect.${a});
  });
  attempt("written by a callback of forEach, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a callback of forEach, asked by a typed function", () => ask3(o));
  attempt("written by a callback of forEach, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a callback of forEach, used", () => o.value + 1);
  attempt("written by a callback of forEach, by its own method", () => o.twice());
}

block3();

class C4 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  const other = {
    get trigger(): number {
      Reflect.${b});
      return 0;
    },
  };
  other.trigger;
  attempt("written by a getter that is read in between, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a getter that is read in between, asked by a typed function", () => ask4(o));
  attempt("written by a getter that is read in between, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a getter that is read in between, used", () => o.value + 1);
  attempt("written by a getter that is read in between, by its own method", () => o.twice());
}

block4();

class C5 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  const other = {
    toString(): string {
      Reflect.${b});
      return "";
    },
  };
  \`\${other}\`;
  attempt("written while another object is turned into text, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written while another object is turned into text, asked by a typed function", () => ask5(o));
  attempt("written while another object is turned into text, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written while another object is turned into text, used", () => o.value + 1);
  attempt("written while another object is turned into text, by its own method", () => o.twice());
}

block5();

class C6 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask6(o: C6): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

async function block6(): Promise<void> {
  const o = new C6();
  await Promise.resolve(o).then(target => {
    Reflect.${a});
  });
  attempt("written by a promise reaction, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a promise reaction, asked by a typed function", () => ask6(o));
  attempt("written by a promise reaction, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a promise reaction, used", () => o.value + 1);
  attempt("written by a promise reaction, by its own method", () => o.twice());
}

await block6();

class C7 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask7(o: C7): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

async function block7(): Promise<void> {
  const o = new C7();
  const pending = Promise.resolve().then(() => {
    Reflect.${b});
  });
  const before = o.value;
  await pending;
  attempt("written during an await, read before the await", () => before);
  attempt("written during an await, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written during an await, asked by a typed function", () => ask7(o));
  attempt("written during an await, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written during an await, used", () => o.value + 1);
  attempt("written during an await, by its own method", () => o.twice());
}

await block7();

class C8 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function* steps8(target: C8): Generator<number> {
  yield 1;
  Reflect.${a});
  yield 2;
}

function ask8(o: C8): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block8(): void {
  const o = new C8();
  for (const step of steps8(o)) void step;
  attempt("written by a step of a generator, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a step of a generator, asked by a typed function", () => ask8(o));
  attempt("written by a step of a generator, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a step of a generator, used", () => o.value + 1);
  attempt("written by a step of a generator, by its own method", () => o.twice());
}

block8();

class C9 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask9(o: C9): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block9(): void {
  const o = new C9();
  try {
    o.twice();
  } finally {
    Reflect.${b});
  }
  attempt("written in a finally block, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written in a finally block, asked by a typed function", () => ask9(o));
  attempt("written in a finally block, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written in a finally block, used", () => o.value + 1);
  attempt("written in a finally block, by its own method", () => o.twice());
}

block9();

class C10 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask10(o: C10): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block10(): void {
  const o = new C10();
  try {
    throw new RangeError("r");
  } catch {
    Reflect.${b});
  }
  attempt("written in a catch block, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written in a catch block, asked by a typed function", () => ask10(o));
  attempt("written in a catch block, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written in a catch block, used", () => o.value + 1);
  attempt("written in a catch block, by its own method", () => o.twice());
}

block10();

export {};
`,
    ),
    ...family(
      `a-list-of-numbers-gets-a-fraction-by-reflect-set-before-each-use.ts	set(list, 1, 1.5
a-list-of-numbers-gets-a-hole-by-reflect-delete-property-before-each-use.ts	deleteProperty(list, 1
a-list-of-numbers-gets-a-longer-length-by-reflect-set-before-each-use.ts	set(list, "length", 5
a-list-of-numbers-gets-a-string-by-reflect-apply-of-its-own-push-before-each-use.ts	apply(list.push, list, ["text"]
a-list-of-numbers-gets-an-element-far-behind-its-end-by-reflect-set-before-each-use.ts	set(list, 9, 7
a-list-of-numbers-gets-an-object-with-value-of-by-reflect-set-before-each-use.ts	set(list, 1, { valueOf: () => 42 }
a-list-of-numbers-gets-not-a-number-by-reflect-define-property-before-each-use.ts	defineProperty(list, 1, { value: NaN }
a-list-of-numbers-gets-undefined-by-reflect-apply-of-fill-before-each-use.ts	apply(Array.prototype.fill, list, [undefined, 1, 2]
a-list-of-numbers-gets-undefined-by-reflect-set-before-each-use.ts	set(list, 1, undefined`,
      a => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("read", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list[1];
});
attempt("typeof", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return typeof list[1];
});
attempt("is undefined", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list[1] === undefined;
});
attempt("is a number", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return typeof list[1] === "number";
});
attempt("plus one", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list[1] + 1;
});
attempt("as an integer", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list[1] | 0;
});
attempt("in", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return 1 in list;
});
attempt("length", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.length;
});
attempt("at", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.at(1);
});
attempt("an index loop", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return (() => {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  })();
});
attempt("for-of", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return (() => {
    let kinds = "";
    for (const n of list) kinds += typeof n + ",";
    return kinds;
  })();
});
attempt("for-in", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return (() => {
    let keys = "";
    for (const key in list) keys += key + ",";
    return keys;
  })();
});
attempt("forEach", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return (() => {
    let kinds = "";
    list.forEach(n => {
      kinds += typeof n + ",";
    });
    return kinds;
  })();
});
attempt("map to kinds", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.map(n => typeof n).join();
});
attempt("map plus one", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.map(n => n + 1).join();
});
attempt("filter undefined", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.filter(n => n === undefined).length;
});
attempt("filter numbers", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.filter(n => typeof n === "number").length;
});
attempt("find what is no number", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return typeof list.find(n => typeof n !== "number");
});
attempt("findIndex of undefined", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.findIndex(n => n === undefined);
});
attempt("findLast", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.findLast(n => n !== 3);
});
attempt("findLastIndex", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.findLastIndex(n => typeof n !== "number");
});
attempt("some", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.some(n => n == null);
});
attempt("every", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.every(n => typeof n === "number");
});
attempt("reduce", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.reduce((a, b) => a + b, 0);
});
attempt("reduceRight", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.reduceRight((a, b) => a + b, 0);
});
attempt("flatMap", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.flatMap(n => [typeof n]).join();
});
attempt("indexOf", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.indexOf(3);
});
attempt("lastIndexOf", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.lastIndexOf(1);
});
attempt("includes 3", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.includes(3);
});
attempt("includes NaN", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.includes(NaN);
});
attempt("join", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.join();
});
attempt("as text", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return String(list);
});
attempt("json", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return JSON.stringify(list);
});
attempt("keys", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return Object.keys(list).join();
});
attempt("entries", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return [...list.entries()].join("|");
});
attempt("spread", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return [...list].map(n => typeof n).join();
});
attempt("Array.from", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return Array.from(list, n => typeof n).join();
});
attempt("slice", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.slice(1).map(n => typeof n).join() + " " + (0 in list.slice(1));
});
attempt("concat", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return [0].concat(list).map(n => typeof n).join() + " " + (2 in [0].concat(list));
});
attempt("toSorted", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.toSorted().join();
});
attempt("sort", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.sort().join();
});
attempt("toSorted by value", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.toSorted((a, b) => a - b).join();
});
attempt("reverse", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.reverse().join();
});
attempt("toReversed", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.toReversed().join();
});
attempt("with", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.with(0, 9).join();
});
attempt("a default in a pattern", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return (([, b = -1]: number[]) => b)(list);
});
attempt("a rest pattern", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return (([, ...rest]: number[]) => rest.map(n => typeof n).join())(list);
});
attempt("the largest", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return Math.max(...list);
});
attempt("a set", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return new Set(list).size;
});
attempt("floats", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return new Float64Array(list).join();
});
attempt("integers", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return new Int32Array(list).join();
});
attempt("a clone", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return JSON.stringify(structuredClone(list));
});
attempt("push", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.push(4) + " " + list.join();
});
attempt("pop", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.pop();
});
attempt("shift", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.shift() + " " + list.join();
});
attempt("unshift", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.unshift(0) + " " + list.join();
});
attempt("splice", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.splice(1, 1).map(n => typeof n).join() + " " + list.join();
});
attempt("fill", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.fill(8).join();
});
attempt("copyWithin", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.copyWithin(0, 1).join();
});
attempt("flat", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return list.flat().length;
});
attempt("a typed store", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return (list[1] = 5) + " " + list.join();
});
attempt("an increment", () => {
  const list: number[] = [1, 2, 3];
  Reflect.${a});
  return ++list[1];
});

export {};
`,
    ),
    ...family(
      `a-list-of-numbers-gets-a-getter-by-define-property-before-each-use.ts	defineProperty(list, 1, { get: () => 50, enumerable: true, configurable: true
a-list-of-numbers-gets-a-number-past-32-bits-by-object-assign-before-each-use.ts	assign(list, { 1: 4294967296
a-list-of-numbers-gets-a-shorter-length-by-define-property-before-each-use.ts	defineProperty(list, "length", { value: 1
a-list-of-numbers-gets-a-string-by-define-property-before-each-use.ts	defineProperty(list, 1, { value: "text"
a-list-of-numbers-gets-minus-zero-by-define-property-before-each-use.ts	defineProperty(list, 1, { value: -0
a-list-of-numbers-gets-null-by-object-assign-before-each-use.ts	assign(list, { 1: null`,
      a => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("read", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list[1];
});
attempt("typeof", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return typeof list[1];
});
attempt("is undefined", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list[1] === undefined;
});
attempt("is a number", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return typeof list[1] === "number";
});
attempt("plus one", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list[1] + 1;
});
attempt("as an integer", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list[1] | 0;
});
attempt("in", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return 1 in list;
});
attempt("length", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.length;
});
attempt("at", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.at(1);
});
attempt("an index loop", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return (() => {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  })();
});
attempt("for-of", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return (() => {
    let kinds = "";
    for (const n of list) kinds += typeof n + ",";
    return kinds;
  })();
});
attempt("for-in", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return (() => {
    let keys = "";
    for (const key in list) keys += key + ",";
    return keys;
  })();
});
attempt("forEach", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return (() => {
    let kinds = "";
    list.forEach(n => {
      kinds += typeof n + ",";
    });
    return kinds;
  })();
});
attempt("map to kinds", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.map(n => typeof n).join();
});
attempt("map plus one", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.map(n => n + 1).join();
});
attempt("filter undefined", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.filter(n => n === undefined).length;
});
attempt("filter numbers", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.filter(n => typeof n === "number").length;
});
attempt("find what is no number", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return typeof list.find(n => typeof n !== "number");
});
attempt("findIndex of undefined", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.findIndex(n => n === undefined);
});
attempt("findLast", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.findLast(n => n !== 3);
});
attempt("findLastIndex", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.findLastIndex(n => typeof n !== "number");
});
attempt("some", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.some(n => n == null);
});
attempt("every", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.every(n => typeof n === "number");
});
attempt("reduce", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.reduce((a, b) => a + b, 0);
});
attempt("reduceRight", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.reduceRight((a, b) => a + b, 0);
});
attempt("flatMap", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.flatMap(n => [typeof n]).join();
});
attempt("indexOf", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.indexOf(3);
});
attempt("lastIndexOf", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.lastIndexOf(1);
});
attempt("includes 3", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.includes(3);
});
attempt("includes NaN", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.includes(NaN);
});
attempt("join", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.join();
});
attempt("as text", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return String(list);
});
attempt("json", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return JSON.stringify(list);
});
attempt("keys", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return Object.keys(list).join();
});
attempt("entries", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return [...list.entries()].join("|");
});
attempt("spread", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return [...list].map(n => typeof n).join();
});
attempt("Array.from", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return Array.from(list, n => typeof n).join();
});
attempt("slice", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.slice(1).map(n => typeof n).join() + " " + (0 in list.slice(1));
});
attempt("concat", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return [0].concat(list).map(n => typeof n).join() + " " + (2 in [0].concat(list));
});
attempt("toSorted", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.toSorted().join();
});
attempt("sort", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.sort().join();
});
attempt("toSorted by value", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.toSorted((a, b) => a - b).join();
});
attempt("reverse", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.reverse().join();
});
attempt("toReversed", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.toReversed().join();
});
attempt("with", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.with(0, 9).join();
});
attempt("a default in a pattern", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return (([, b = -1]: number[]) => b)(list);
});
attempt("a rest pattern", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return (([, ...rest]: number[]) => rest.map(n => typeof n).join())(list);
});
attempt("the largest", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return Math.max(...list);
});
attempt("a set", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return new Set(list).size;
});
attempt("floats", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return new Float64Array(list).join();
});
attempt("integers", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return new Int32Array(list).join();
});
attempt("a clone", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return JSON.stringify(structuredClone(list));
});
attempt("push", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.push(4) + " " + list.join();
});
attempt("pop", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.pop();
});
attempt("shift", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.shift() + " " + list.join();
});
attempt("unshift", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.unshift(0) + " " + list.join();
});
attempt("splice", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.splice(1, 1).map(n => typeof n).join() + " " + list.join();
});
attempt("fill", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.fill(8).join();
});
attempt("copyWithin", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.copyWithin(0, 1).join();
});
attempt("flat", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return list.flat().length;
});
attempt("a typed store", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return (list[1] = 5) + " " + list.join();
});
attempt("an increment", () => {
  const list: number[] = [1, 2, 3];
  Object.${a} });
  return ++list[1];
});

export {};
`,
    ),
    ...family(
      `a-list-of-numbers-gets-a-string-by-a-borrowed-fill-before-each-use.ts	fill.call(list, "text", 1, 2
a-list-of-numbers-gets-a-string-by-a-borrowed-push-before-each-use.ts	push.call(list, "text"
a-list-of-numbers-gets-a-string-by-a-borrowed-splice-before-each-use.ts	splice.call(list, 1, 1, "text"
a-list-of-numbers-gets-a-string-by-a-borrowed-unshift-before-each-use.ts	unshift.call(list, "text"`,
      a => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("read", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list[1];
});
attempt("typeof", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return typeof list[1];
});
attempt("is undefined", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list[1] === undefined;
});
attempt("is a number", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return typeof list[1] === "number";
});
attempt("plus one", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list[1] + 1;
});
attempt("as an integer", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list[1] | 0;
});
attempt("in", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return 1 in list;
});
attempt("length", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.length;
});
attempt("at", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.at(1);
});
attempt("an index loop", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return (() => {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  })();
});
attempt("for-of", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return (() => {
    let kinds = "";
    for (const n of list) kinds += typeof n + ",";
    return kinds;
  })();
});
attempt("for-in", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return (() => {
    let keys = "";
    for (const key in list) keys += key + ",";
    return keys;
  })();
});
attempt("forEach", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return (() => {
    let kinds = "";
    list.forEach(n => {
      kinds += typeof n + ",";
    });
    return kinds;
  })();
});
attempt("map to kinds", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.map(n => typeof n).join();
});
attempt("map plus one", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.map(n => n + 1).join();
});
attempt("filter undefined", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.filter(n => n === undefined).length;
});
attempt("filter numbers", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.filter(n => typeof n === "number").length;
});
attempt("find what is no number", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return typeof list.find(n => typeof n !== "number");
});
attempt("findIndex of undefined", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.findIndex(n => n === undefined);
});
attempt("findLast", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.findLast(n => n !== 3);
});
attempt("findLastIndex", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.findLastIndex(n => typeof n !== "number");
});
attempt("some", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.some(n => n == null);
});
attempt("every", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.every(n => typeof n === "number");
});
attempt("reduce", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.reduce((a, b) => a + b, 0);
});
attempt("reduceRight", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.reduceRight((a, b) => a + b, 0);
});
attempt("flatMap", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.flatMap(n => [typeof n]).join();
});
attempt("indexOf", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.indexOf(3);
});
attempt("lastIndexOf", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.lastIndexOf(1);
});
attempt("includes 3", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.includes(3);
});
attempt("includes NaN", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.includes(NaN);
});
attempt("join", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.join();
});
attempt("as text", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return String(list);
});
attempt("json", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return JSON.stringify(list);
});
attempt("keys", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return Object.keys(list).join();
});
attempt("entries", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return [...list.entries()].join("|");
});
attempt("spread", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return [...list].map(n => typeof n).join();
});
attempt("Array.from", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return Array.from(list, n => typeof n).join();
});
attempt("slice", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.slice(1).map(n => typeof n).join() + " " + (0 in list.slice(1));
});
attempt("concat", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return [0].concat(list).map(n => typeof n).join() + " " + (2 in [0].concat(list));
});
attempt("toSorted", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.toSorted().join();
});
attempt("sort", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.sort().join();
});
attempt("toSorted by value", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.toSorted((a, b) => a - b).join();
});
attempt("reverse", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.reverse().join();
});
attempt("toReversed", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.toReversed().join();
});
attempt("with", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.with(0, 9).join();
});
attempt("a default in a pattern", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return (([, b = -1]: number[]) => b)(list);
});
attempt("a rest pattern", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return (([, ...rest]: number[]) => rest.map(n => typeof n).join())(list);
});
attempt("the largest", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return Math.max(...list);
});
attempt("a set", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return new Set(list).size;
});
attempt("floats", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return new Float64Array(list).join();
});
attempt("integers", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return new Int32Array(list).join();
});
attempt("a clone", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return JSON.stringify(structuredClone(list));
});
attempt("push", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.push(4) + " " + list.join();
});
attempt("pop", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.pop();
});
attempt("shift", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.shift() + " " + list.join();
});
attempt("unshift", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.unshift(0) + " " + list.join();
});
attempt("splice", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.splice(1, 1).map(n => typeof n).join() + " " + list.join();
});
attempt("fill", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.fill(8).join();
});
attempt("copyWithin", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.copyWithin(0, 1).join();
});
attempt("flat", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return list.flat().length;
});
attempt("a typed store", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return (list[1] = 5) + " " + list.join();
});
attempt("an increment", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.${a});
  return ++list[1];
});

export {};
`,
    ),
    ...family(
      `a-list-of-numbers-gets-values-by-borrowed-methods-inside-the-loop-that-reads-it.ts	borrowed fill	Array.prototype.fill.call(list, "text", 1, 2	a borrowed splice	Array.prototype.splice.call(list, 1, 1, "text"	borrowed push	Array.prototype.push.call(list, "text"
a-list-of-numbers-gets-values-of-other-kinds-by-define-property-and-object-assign-inside-the-loop-that-reads-it.ts	string is defined	Object.defineProperty(list, 1, { value: "text" }	null is assigned	Object.assign(list, { 1: null }	getter is defined	Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true }
a-list-of-numbers-gets-values-of-other-kinds-by-reflect-set-inside-the-loop-that-reads-it.ts	string	Reflect.set(list, 1, "text"	undefined	Reflect.set(list, 1, undefined	fraction	Reflect.set(list, 1, 2.5`,
      (a, b, c, d, e, f) => `function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("a ${a}, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${a}, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${b});
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a ${a}, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${b});
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("${c}, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("${c}, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${d});
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("${c}, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${d});
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("a ${e}, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a ${e}, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ${f});
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a ${e}, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) ${f});
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});

export {};
`,
    ),
    ...family(
      `define-properties-gives-each-field-of-an-instance-another-kind-of-value.ts	becomes a string", p => { Object.defineProperties(p, { count: { value: "text" } }	becomes a number", p => { Object.defineProperties(p, { label: { value: 7 } }	becomes null", p => { Object.defineProperties(p, { inner: { value: null } }	becomes a number", p => { Object.defineProperties(p, { action: { value: 5 } }	becomes a number", p => { Object.defineProperties(p, { note: { value: 5 } }	becomes a string", p => { Object.defineProperties(p, { id: { value: "text" } }
reflect-define-property-gives-each-field-of-an-instance-another-kind-of-value.ts	becomes a string", p => { Reflect.defineProperty(p, "count", { value: "text" }	becomes a number", p => { Reflect.defineProperty(p, "label", { value: 7 }	becomes null", p => { Reflect.defineProperty(p, "inner", { value: null }	becomes a number", p => { Reflect.defineProperty(p, "action", { value: 5 }	becomes a number", p => { Reflect.defineProperty(p, "note", { value: 5 }	becomes a string", p => { Reflect.defineProperty(p, "id", { value: "text" }
reflect-delete-property-removes-each-field-of-an-instance.ts	is deleted", p => { Reflect.deleteProperty(p, "count"	is deleted", p => { Reflect.deleteProperty(p, "label"	is deleted", p => { Reflect.deleteProperty(p, "inner"	is deleted", p => { Reflect.deleteProperty(p, "action"	is deleted", p => { Reflect.deleteProperty(p, "note"	is deleted", p => { Reflect.deleteProperty(p, "id"`,
      (a, b, c, d, e, f) => `interface Inner {
  depth: number;
}

class Part {
  count = 1;
  label = "part";
  inner: Inner = { depth: 2 };
  action: () => number = () => 3;
  note?: string = "note";
  readonly id: number = 4;
  total(): number {
    return this.count + this.inner.depth + this.action() + this.id;
  }
  title(): string {
    return this.label + ":" + (this.note ?? "none");
  }
}

class SubPart extends Part {
  extra = 5;
  total(): number {
    return super.total() + this.extra;
  }
}

function fresh(): Part {
  return new Part();
}

function other(): Part {
  return new SubPart();
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function plusOne(p: Part): number {
  return p.count + 1;
}

function useCount(label: string, p: Part): void {
  attempt(label + ", read", () => p.count);
  attempt(label + ", typeof", () => typeof p.count);
  attempt(label + ", plus one", () => p.count + 1);
  attempt(label + ", doubled", () => p.count * 2);
  attempt(label + ", as an integer", () => p.count | 0);
  attempt(label + ", compared", () => p.count > 0);
  attempt(label + ", is undefined", () => p.count === undefined);
  attempt(label + ", is null or undefined", () => p.count == null);
  attempt(label + ", is a number", () => typeof p.count === "number");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.count === "number").length);
  attempt(label + ", a method of the number", () => p.count.toFixed(1));
  attempt(label + ", a typed function", () => plusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", incremented", () => ++p.count);
  attempt(label + ", stored", () => (p.count = 10));
  attempt(label + ", read after the store", () => p.count);
}

function briefCount(label: string, p: Part): void {
  attempt(label + ", used", () => p.count + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function countInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.count + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].count + 1);
  attempt(label + ", a result", () => make().count + 1);
}

function countInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.count + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function lengthOf(p: Part): number {
  return p.label.length;
}

function useLabel(label: string, p: Part): void {
  attempt(label + ", read", () => p.label);
  attempt(label + ", typeof", () => typeof p.label);
  attempt(label + ", its length", () => p.label.length);
  attempt(label + ", glued", () => p.label + "!");
  attempt(label + ", a method of the string", () => p.label.toUpperCase());
  attempt(label + ", compared", () => p.label === "part");
  attempt(label + ", is undefined", () => p.label === undefined);
  attempt(label + ", is a string", () => typeof p.label === "string");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.label === "string").length);
  attempt(label + ", a typed function", () => lengthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", appended to", () => (p.label += "?"));
  attempt(label + ", stored", () => (p.label = "stored"));
  attempt(label + ", read after the store", () => p.label);
}

function briefLabel(label: string, p: Part): void {
  attempt(label + ", used", () => p.label.length);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function labelInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.label.length);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].label.length);
  attempt(label + ", a result", () => make().label.length);
}

function labelInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.label.length;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function depthOf(p: Part): number {
  return p.inner.depth;
}

function useInner(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.inner);
  attempt(label + ", is undefined", () => p.inner === undefined);
  attempt(label + ", is null", () => p.inner === null);
  attempt(label + ", is truthy", () => !!p.inner);
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.inner === "object" && q.inner !== null).length);
  attempt(label + ", its member", () => p.inner.depth);
  attempt(label + ", its member plus one", () => p.inner.depth + 1);
  attempt(label + ", its keys", () => Object.keys(p.inner).join());
  attempt(label + ", a copy of it", () => JSON.stringify({ ...p.inner }));
  attempt(label + ", in", () => "depth" in p.inner);
  attempt(label + ", a pattern", () => (({ depth }: Inner) => depth)(p.inner));
  attempt(label + ", a typed function", () => depthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", its member stored", () => (p.inner.depth = 9));
  attempt(label + ", its member after the store", () => p.inner.depth);
  attempt(label + ", replaced", () => (p.inner = { depth: 8 }).depth);
  attempt(label + ", its member after that", () => p.inner.depth);
}

function briefInner(label: string, p: Part): void {
  attempt(label + ", used", () => p.inner.depth);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function innerInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.inner.depth);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].inner.depth);
  attempt(label + ", a result", () => make().inner.depth);
}

function innerInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.inner.depth;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function run(p: Part): number {
  return p.action();
}

function useAction(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.action);
  attempt(label + ", is undefined", () => p.action === undefined);
  attempt(label + ", is a function", () => typeof p.action === "function");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.action === "function").length);
  attempt(label + ", called", () => p.action());
  attempt(label + ", its result plus one", () => p.action() + 1);
  attempt(label + ", taken off and called", () => (f => f())(p.action));
  attempt(label + ", through call", () => p.action.call(undefined));
  attempt(label + ", its length", () => p.action.length);
  attempt(label + ", a typed function", () => run(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", replaced and called", () => (p.action = () => 30)());
  attempt(label + ", called after that", () => p.action());
}

function briefAction(label: string, p: Part): void {
  attempt(label + ", used", () => p.action());
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function actionInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.action());
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].action());
  attempt(label + ", a result", () => make().action());
}

function actionInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.action();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function noteOf(p: Part): string {
  return p.note ?? "none";
}

function useNote(label: string, p: Part): void {
  attempt(label + ", read", () => p.note);
  attempt(label + ", typeof", () => typeof p.note);
  attempt(label + ", is undefined", () => p.note === undefined);
  attempt(label + ", is a string", () => typeof p.note === "string");
  attempt(label + ", or a default", () => p.note ?? "none");
  attempt(label + ", its length", () => p.note?.length);
  attempt(label + ", in", () => "note" in p);
  attempt(label + ", a typed function", () => noteOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", stored", () => (p.note = "stored"));
  attempt(label + ", read after the store", () => p.note);
  attempt(label + ", deleted", () => delete p.note);
  attempt(label + ", read after the delete", () => p.note);
}

function briefNote(label: string, p: Part): void {
  attempt(label + ", used", () => (p.note ?? "none"));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function noteInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => (holder.part.note ?? "none"));
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => (list[1].note ?? "none"));
  attempt(label + ", a result", () => (make().note ?? "none"));
}

function noteInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = (p.note ?? "none");
      if (typeof value === "string") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function idPlusOne(p: Part): number {
  return p.id + 1;
}

function useId(label: string, p: Part): void {
  attempt(label + ", read", () => p.id);
  attempt(label + ", typeof", () => typeof p.id);
  attempt(label + ", is undefined", () => p.id === undefined);
  attempt(label + ", is a number", () => typeof p.id === "number");
  attempt(label + ", plus one", () => p.id + 1);
  attempt(label + ", as an integer", () => p.id | 0);
  attempt(label + ", a typed function", () => idPlusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
}

function briefId(label: string, p: Part): void {
  attempt(label + ", used", () => p.id + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function idInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.id + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].id + 1);
  attempt(label + ", a result", () => make().id + 1);
}

function idInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.id + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const countWrites: [string, (p: Part) => void][] = [
  ["count ${a}); }],
];

const labelWrites: [string, (p: Part) => void][] = [
  ["label ${b}); }],
];

const innerWrites: [string, (p: Part) => void][] = [
  ["inner ${c}); }],
];

const actionWrites: [string, (p: Part) => void][] = [
  ["action ${d}); }],
];

const noteWrites: [string, (p: Part) => void][] = [
  ["note ${e}); }],
];

const idWrites: [string, (p: Part) => void][] = [
  ["id ${f}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useCount("", fresh());
  briefCount("", other());
  useLabel("", fresh());
  briefLabel("", other());
  useInner("", fresh());
  briefInner("", other());
  useAction("", fresh());
  briefAction("", other());
  useNote("", fresh());
  briefNote("", other());
  useId("", fresh());
  briefId("", other());
}
countInPlaces("", fresh);
countInALoop("", () => {});
labelInPlaces("", fresh);
labelInALoop("", () => {});
innerInPlaces("", fresh);
innerInALoop("", () => {});
actionInPlaces("", fresh);
actionInALoop("", () => {});
noteInPlaces("", fresh);
noteInALoop("", () => {});
idInPlaces("", fresh);
idInALoop("", () => {});
quiet = false;

useCount("untouched", fresh());

for (const [label, write] of countWrites) {
  const first = fresh();
  write(first);
  useCount(label + ", an instance", first);
  const second = other();
  write(second);
  briefCount(label + ", a subclass instance", second);
  countInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  countInALoop(label, write);
}

useCount("untouched afterwards", fresh());

useLabel("untouched", fresh());

for (const [label, write] of labelWrites) {
  const first = fresh();
  write(first);
  useLabel(label + ", an instance", first);
  const second = other();
  write(second);
  briefLabel(label + ", a subclass instance", second);
  labelInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  labelInALoop(label, write);
}

useLabel("untouched afterwards", fresh());

useInner("untouched", fresh());

for (const [label, write] of innerWrites) {
  const first = fresh();
  write(first);
  useInner(label + ", an instance", first);
  const second = other();
  write(second);
  briefInner(label + ", a subclass instance", second);
  innerInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  innerInALoop(label, write);
}

useInner("untouched afterwards", fresh());

useAction("untouched", fresh());

for (const [label, write] of actionWrites) {
  const first = fresh();
  write(first);
  useAction(label + ", an instance", first);
  const second = other();
  write(second);
  briefAction(label + ", a subclass instance", second);
  actionInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  actionInALoop(label, write);
}

useAction("untouched afterwards", fresh());

useNote("untouched", fresh());

for (const [label, write] of noteWrites) {
  const first = fresh();
  write(first);
  useNote(label + ", an instance", first);
  const second = other();
  write(second);
  briefNote(label + ", a subclass instance", second);
  noteInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  noteInALoop(label, write);
}

useNote("untouched afterwards", fresh());

useId("untouched", fresh());

for (const [label, write] of idWrites) {
  const first = fresh();
  write(first);
  useId(label + ", an instance", first);
  const second = other();
  write(second);
  briefId(label + ", a subclass instance", second);
  idInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  idInALoop(label, write);
}

useId("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `define-properties-gives-each-member-of-a-literal-another-kind-of-value.ts	becomes a string", p => { Object.defineProperties(p, { count: { value: "text" } }	becomes a number", p => { Object.defineProperties(p, { label: { value: 7 } }	becomes null", p => { Object.defineProperties(p, { inner: { value: null } }	becomes a number", p => { Object.defineProperties(p, { action: { value: 5 } }	becomes a number", p => { Object.defineProperties(p, { note: { value: 5 } }	becomes a string", p => { Object.defineProperties(p, { id: { value: "text" } }
reflect-define-property-gives-each-member-of-a-literal-another-kind-of-value.ts	becomes a string", p => { Reflect.defineProperty(p, "count", { value: "text" }	becomes a number", p => { Reflect.defineProperty(p, "label", { value: 7 }	becomes null", p => { Reflect.defineProperty(p, "inner", { value: null }	becomes a number", p => { Reflect.defineProperty(p, "action", { value: 5 }	becomes a number", p => { Reflect.defineProperty(p, "note", { value: 5 }	becomes a string", p => { Reflect.defineProperty(p, "id", { value: "text" }
reflect-delete-property-removes-each-member-of-a-literal.ts	is deleted", p => { Reflect.deleteProperty(p, "count"	is deleted", p => { Reflect.deleteProperty(p, "label"	is deleted", p => { Reflect.deleteProperty(p, "inner"	is deleted", p => { Reflect.deleteProperty(p, "action"	is deleted", p => { Reflect.deleteProperty(p, "note"	is deleted", p => { Reflect.deleteProperty(p, "id"`,
      (a, b, c, d, e, f) => `interface Inner {
  depth: number;
}

interface Part {
  count: number;
  label: string;
  inner: Inner;
  action: () => number;
  note?: string;
  readonly id: number;
  total(): number;
  title(): string;
}

function fresh(): Part {
  return {
    count: 1,
    label: "part",
    inner: { depth: 2 },
    action: () => 3,
    note: "note",
    id: 4,
    total() {
      return this.count + this.inner.depth + this.action() + this.id;
    },
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
  };
}

function other(): Part {
  return {
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
    total() {
      return this.count + this.inner.depth + this.action() + this.id + 5;
    },
    id: 4,
    note: "note",
    action: () => 3,
    inner: { depth: 2 },
    label: "part",
    count: 1,
  };
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function plusOne(p: Part): number {
  return p.count + 1;
}

function useCount(label: string, p: Part): void {
  attempt(label + ", read", () => p.count);
  attempt(label + ", typeof", () => typeof p.count);
  attempt(label + ", plus one", () => p.count + 1);
  attempt(label + ", doubled", () => p.count * 2);
  attempt(label + ", as an integer", () => p.count | 0);
  attempt(label + ", compared", () => p.count > 0);
  attempt(label + ", is undefined", () => p.count === undefined);
  attempt(label + ", is null or undefined", () => p.count == null);
  attempt(label + ", is a number", () => typeof p.count === "number");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.count === "number").length);
  attempt(label + ", a method of the number", () => p.count.toFixed(1));
  attempt(label + ", a typed function", () => plusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", incremented", () => ++p.count);
  attempt(label + ", stored", () => (p.count = 10));
  attempt(label + ", read after the store", () => p.count);
}

function briefCount(label: string, p: Part): void {
  attempt(label + ", used", () => p.count + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function countInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.count + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].count + 1);
  attempt(label + ", a result", () => make().count + 1);
}

function countInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.count + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function lengthOf(p: Part): number {
  return p.label.length;
}

function useLabel(label: string, p: Part): void {
  attempt(label + ", read", () => p.label);
  attempt(label + ", typeof", () => typeof p.label);
  attempt(label + ", its length", () => p.label.length);
  attempt(label + ", glued", () => p.label + "!");
  attempt(label + ", a method of the string", () => p.label.toUpperCase());
  attempt(label + ", compared", () => p.label === "part");
  attempt(label + ", is undefined", () => p.label === undefined);
  attempt(label + ", is a string", () => typeof p.label === "string");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.label === "string").length);
  attempt(label + ", a typed function", () => lengthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", appended to", () => (p.label += "?"));
  attempt(label + ", stored", () => (p.label = "stored"));
  attempt(label + ", read after the store", () => p.label);
}

function briefLabel(label: string, p: Part): void {
  attempt(label + ", used", () => p.label.length);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function labelInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.label.length);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].label.length);
  attempt(label + ", a result", () => make().label.length);
}

function labelInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.label.length;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function depthOf(p: Part): number {
  return p.inner.depth;
}

function useInner(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.inner);
  attempt(label + ", is undefined", () => p.inner === undefined);
  attempt(label + ", is null", () => p.inner === null);
  attempt(label + ", is truthy", () => !!p.inner);
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.inner === "object" && q.inner !== null).length);
  attempt(label + ", its member", () => p.inner.depth);
  attempt(label + ", its member plus one", () => p.inner.depth + 1);
  attempt(label + ", its keys", () => Object.keys(p.inner).join());
  attempt(label + ", a copy of it", () => JSON.stringify({ ...p.inner }));
  attempt(label + ", in", () => "depth" in p.inner);
  attempt(label + ", a pattern", () => (({ depth }: Inner) => depth)(p.inner));
  attempt(label + ", a typed function", () => depthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", its member stored", () => (p.inner.depth = 9));
  attempt(label + ", its member after the store", () => p.inner.depth);
  attempt(label + ", replaced", () => (p.inner = { depth: 8 }).depth);
  attempt(label + ", its member after that", () => p.inner.depth);
}

function briefInner(label: string, p: Part): void {
  attempt(label + ", used", () => p.inner.depth);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function innerInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.inner.depth);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].inner.depth);
  attempt(label + ", a result", () => make().inner.depth);
}

function innerInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.inner.depth;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function run(p: Part): number {
  return p.action();
}

function useAction(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.action);
  attempt(label + ", is undefined", () => p.action === undefined);
  attempt(label + ", is a function", () => typeof p.action === "function");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.action === "function").length);
  attempt(label + ", called", () => p.action());
  attempt(label + ", its result plus one", () => p.action() + 1);
  attempt(label + ", taken off and called", () => (f => f())(p.action));
  attempt(label + ", through call", () => p.action.call(undefined));
  attempt(label + ", its length", () => p.action.length);
  attempt(label + ", a typed function", () => run(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", replaced and called", () => (p.action = () => 30)());
  attempt(label + ", called after that", () => p.action());
}

function briefAction(label: string, p: Part): void {
  attempt(label + ", used", () => p.action());
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function actionInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.action());
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].action());
  attempt(label + ", a result", () => make().action());
}

function actionInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.action();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function noteOf(p: Part): string {
  return p.note ?? "none";
}

function useNote(label: string, p: Part): void {
  attempt(label + ", read", () => p.note);
  attempt(label + ", typeof", () => typeof p.note);
  attempt(label + ", is undefined", () => p.note === undefined);
  attempt(label + ", is a string", () => typeof p.note === "string");
  attempt(label + ", or a default", () => p.note ?? "none");
  attempt(label + ", its length", () => p.note?.length);
  attempt(label + ", in", () => "note" in p);
  attempt(label + ", a typed function", () => noteOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", stored", () => (p.note = "stored"));
  attempt(label + ", read after the store", () => p.note);
  attempt(label + ", deleted", () => delete p.note);
  attempt(label + ", read after the delete", () => p.note);
}

function briefNote(label: string, p: Part): void {
  attempt(label + ", used", () => (p.note ?? "none"));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function noteInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => (holder.part.note ?? "none"));
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => (list[1].note ?? "none"));
  attempt(label + ", a result", () => (make().note ?? "none"));
}

function noteInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = (p.note ?? "none");
      if (typeof value === "string") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function idPlusOne(p: Part): number {
  return p.id + 1;
}

function useId(label: string, p: Part): void {
  attempt(label + ", read", () => p.id);
  attempt(label + ", typeof", () => typeof p.id);
  attempt(label + ", is undefined", () => p.id === undefined);
  attempt(label + ", is a number", () => typeof p.id === "number");
  attempt(label + ", plus one", () => p.id + 1);
  attempt(label + ", as an integer", () => p.id | 0);
  attempt(label + ", a typed function", () => idPlusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
}

function briefId(label: string, p: Part): void {
  attempt(label + ", used", () => p.id + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function idInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.id + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].id + 1);
  attempt(label + ", a result", () => make().id + 1);
}

function idInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.id + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const countWrites: [string, (p: Part) => void][] = [
  ["count ${a}); }],
];

const labelWrites: [string, (p: Part) => void][] = [
  ["label ${b}); }],
];

const innerWrites: [string, (p: Part) => void][] = [
  ["inner ${c}); }],
];

const actionWrites: [string, (p: Part) => void][] = [
  ["action ${d}); }],
];

const noteWrites: [string, (p: Part) => void][] = [
  ["note ${e}); }],
];

const idWrites: [string, (p: Part) => void][] = [
  ["id ${f}); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useCount("", fresh());
  briefCount("", other());
  useLabel("", fresh());
  briefLabel("", other());
  useInner("", fresh());
  briefInner("", other());
  useAction("", fresh());
  briefAction("", other());
  useNote("", fresh());
  briefNote("", other());
  useId("", fresh());
  briefId("", other());
}
countInPlaces("", fresh);
countInALoop("", () => {});
labelInPlaces("", fresh);
labelInALoop("", () => {});
innerInPlaces("", fresh);
innerInALoop("", () => {});
actionInPlaces("", fresh);
actionInALoop("", () => {});
noteInPlaces("", fresh);
noteInALoop("", () => {});
idInPlaces("", fresh);
idInALoop("", () => {});
quiet = false;

useCount("untouched", fresh());

for (const [label, write] of countWrites) {
  const first = fresh();
  write(first);
  useCount(label + ", a literal", first);
  const second = other();
  write(second);
  briefCount(label + ", a literal written backwards", second);
  countInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  countInALoop(label, write);
}

useCount("untouched afterwards", fresh());

useLabel("untouched", fresh());

for (const [label, write] of labelWrites) {
  const first = fresh();
  write(first);
  useLabel(label + ", a literal", first);
  const second = other();
  write(second);
  briefLabel(label + ", a literal written backwards", second);
  labelInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  labelInALoop(label, write);
}

useLabel("untouched afterwards", fresh());

useInner("untouched", fresh());

for (const [label, write] of innerWrites) {
  const first = fresh();
  write(first);
  useInner(label + ", a literal", first);
  const second = other();
  write(second);
  briefInner(label + ", a literal written backwards", second);
  innerInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  innerInALoop(label, write);
}

useInner("untouched afterwards", fresh());

useAction("untouched", fresh());

for (const [label, write] of actionWrites) {
  const first = fresh();
  write(first);
  useAction(label + ", a literal", first);
  const second = other();
  write(second);
  briefAction(label + ", a literal written backwards", second);
  actionInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  actionInALoop(label, write);
}

useAction("untouched afterwards", fresh());

useNote("untouched", fresh());

for (const [label, write] of noteWrites) {
  const first = fresh();
  write(first);
  useNote(label + ", a literal", first);
  const second = other();
  write(second);
  briefNote(label + ", a literal written backwards", second);
  noteInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  noteInALoop(label, write);
}

useNote("untouched afterwards", fresh());

useId("untouched", fresh());

for (const [label, write] of idWrites) {
  const first = fresh();
  write(first);
  useId(label + ", a literal", first);
  const second = other();
  write(second);
  briefId(label + ", a literal written backwards", second);
  idInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  idInALoop(label, write);
}

useId("untouched afterwards", fresh());

export {};
`,
    ),
    ...family(
      `each-route-alone/a-name-asked-for-with-in-appears-by-a-getter-defined-later.ts	defineProperty(c, "edge", { get: () => "added", enumerable: true
each-route-alone/a-name-asked-for-with-in-appears-by-a-new-parent-of-the-prototype-of-the-class.ts	setPrototypeOf(Circle.prototype, { edge: "added"
each-route-alone/a-name-asked-for-with-in-appears-by-a-new-prototype-of-the-instance.ts	setPrototypeOf(c, { edge: "added"
each-route-alone/a-name-asked-for-with-in-appears-by-define-property-on-the-prototype-of-the-class.ts	defineProperty(Circle.prototype, "edge", { get: () => "added"
each-route-alone/a-name-asked-for-with-in-appears-by-define-property.ts	defineProperty(c, "edge", { value: "added", enumerable: true
each-route-alone/a-name-asked-for-with-in-appears-by-object-assign-onto-the-prototype-of-the-class.ts	assign(Circle.prototype, { edge: "added"
each-route-alone/a-name-asked-for-with-in-appears-by-object-assign.ts	assign(c, { edge: "added"`,
      a => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  radius = 1;
}

class Square {
  edge = 2;
}

function edgeOrRadius(s: Circle | Square): string {
  if ("edge" in s) return "edge " + typeof s.edge + " " + String(s.edge);
  return "radius " + s.radius;
}

function change(c: Circle): void {
  Object.${a} });
}

let honest = "";
for (let i = 0; i < 2000; i++) honest = edgeOrRadius(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", honest);
const circle = new Circle();
say("before", edgeOrRadius(circle));
say("before: in", "edge" in circle);
change(circle);
say("after", edgeOrRadius(circle));
say("after: in", "edge" in circle);
say("after: own", Object.hasOwn(circle, "edge"));
say("after: keys", Object.keys(circle).length);
say("after: radius", circle.radius);
say("a fresh circle", edgeOrRadius(new Circle()));
say("a fresh square", edgeOrRadius(new Square()));
`,
    ),
    ...family(
      `each-route-alone/a-name-asked-for-with-in-appears-by-a-proxy.ts	new Proxy(c, {})	"added"
each-route-alone/a-name-asked-for-with-in-appears-by-a-store-of-undefined-through-a-view.ts	c	undefined
each-route-alone/a-name-asked-for-with-in-appears-by-a-store-through-a-view-with-an-optional-member.ts	c	"added"`,
      (a, b) => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  radius = 1;
}

class Square {
  edge = 2;
}

function edgeOrRadius(s: Circle | Square): string {
  if ("edge" in s) return "edge " + typeof s.edge + " " + String(s.edge);
  return "radius " + s.radius;
}

function change(c: Circle): void {
  const loose: { radius: number; edge?: string } = ${a};
  loose.edge = ${b};
}

let honest = "";
for (let i = 0; i < 2000; i++) honest = edgeOrRadius(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", honest);
const circle = new Circle();
say("before", edgeOrRadius(circle));
say("before: in", "edge" in circle);
change(circle);
say("after", edgeOrRadius(circle));
say("after: in", "edge" in circle);
say("after: own", Object.hasOwn(circle, "edge"));
say("after: keys", Object.keys(circle).length);
say("after: radius", circle.radius);
say("a fresh circle", edgeOrRadius(new Circle()));
say("a fresh square", edgeOrRadius(new Square()));
`,
    ),
    ...family(
      `each-route-alone/a-sound-member-changes-by-an-object-pattern.ts	({ count: c.count, ready: c.ready, title: c.title, run: c.run } = { count: 2.5, ready: true, title: "bcd",
each-route-alone/a-sound-member-changes-by-object-assign-of-parsed-text.ts	Object.assign(c, JSON.parse('{"count":2.5,"ready":true,"title":"bcd"}'), {
each-route-alone/a-sound-member-changes-by-object-assign.ts	Object.assign(c, { count: 2.5, ready: true, title: "bcd",`,
      a => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Cell {
  count = 1;
  ready = false;
  title = "a";
  run: () => number = () => 1;
  other = 5;
}

function describe(c: Cell): string {
  return [c.count + 1, c.count * 2, c.ready ? "ready" : "not ready", c.title + "!", c.title.length, c.run(), c.other].join(" ");
}

function change(c: Cell): void {
  ${a} run: () => 2 });
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const c = new Cell();
  sum += c.count + c.run() + (c.ready ? 1 : 0) + c.title.length;
}
say("honest rounds", sum);
const cell = new Cell();
say("before", describe(cell));
change(cell);
say("count", cell.count);
say("count plus one", cell.count + 1);
say("ready", cell.ready);
say("ready picks", cell.ready ? "ready" : "not ready");
say("title", cell.title);
say("run", cell.run());
say("after", describe(cell));
say("a fresh cell", describe(new Cell()));
`,
    ),
    ...family(
      `each-route-alone/a-member-gets-another-kind-by-a-plain-store.ts	= "text"	
each-route-alone/a-member-gets-another-kind-by-a-template.ts	= \`\${c.value}\`	
each-route-alone/a-member-gets-another-kind-by-and-equals.ts	&&= "text"	&&
each-route-alone/a-member-gets-another-kind-by-plus-equals-with-a-string.ts	+= "text"	`,
      (a, b) => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Leaf {
  weight = 7;
}

class Cell {
  value: number | string = 1;
  leaf: Leaf | null = new Leaf();
  other = 5;
}

function describe(c: Cell): string {
  const value = typeof c.value === "number" ? "number " + (c.value + 1) : "string " + c.value.length;
  const leaf = c.leaf === null ? "null" : "leaf " + c.leaf.weight;
  return value + ", " + leaf + ", " + c.other;
}

function change(c: Cell): void {
  c.value ${a};
  c.leaf ${b}= null;
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const c = new Cell();
  if (typeof c.value === "number" && c.leaf !== null) sum += c.value + c.leaf.weight;
}
say("honest rounds", sum);
const cell = new Cell();
say("before", describe(cell));
if (typeof cell.value === "number" && cell.leaf !== null) {
  change(cell);
  say("value", cell.value);
  say("value plus one", cell.value + 1);
  say("value doubled", cell.value * 2);
  say("leaf", cell.leaf === null ? "null" : "a leaf");
}
say("after", describe(cell));
say("a fresh cell", describe(new Cell()));
`,
    ),
    ...family(
      `each-route-alone/a-sound-member-changes-by-a-bound-function.ts	bind(c)(
each-route-alone/a-sound-member-changes-by-a-function-called-with-apply.ts	apply(c
each-route-alone/a-sound-member-changes-by-a-function-called-with-call.ts	call(c`,
      a => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Cell {
  count = 1;
  ready = false;
  title = "a";
  run: () => number = () => 1;
  other = 5;
}

function storesToThis(this: Cell): void {
  this.count = 2.5;
  this.ready = true;
  this.title = "bcd";
  this.run = () => 2;
}

function describe(c: Cell): string {
  return [c.count + 1, c.count * 2, c.ready ? "ready" : "not ready", c.title + "!", c.title.length, c.run(), c.other].join(" ");
}

function change(c: Cell): void {
  storesToThis.${a});
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const c = new Cell();
  sum += c.count + c.run() + (c.ready ? 1 : 0) + c.title.length;
}
say("honest rounds", sum);
const cell = new Cell();
say("before", describe(cell));
change(cell);
say("count", cell.count);
say("count plus one", cell.count + 1);
say("ready", cell.ready);
say("ready picks", cell.ready ? "ready" : "not ready");
say("title", cell.title);
say("run", cell.run());
say("after", describe(cell));
say("a fresh cell", describe(new Cell()));
`,
    ),
    ...family(
      `each-route-alone/a-square-made-by-a-literal-in-another-order.ts	corner: 90, edge: 2, kind: "square"
each-route-alone/a-square-made-by-a-literal.ts	kind: "square", edge: 2, corner: 90
each-route-alone/a-square-made-by-a-spread.ts	...new Square()`,
      a => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  kind: "circle" = "circle";
  radius = 1;
}

class Square {
  kind: "square" = "square";
  edge = 2;
  corner = 90;
}

type Tagged = { kind: "circle" | "square" };

function make(): Square {
  return { ${a} };
}

function area(s: Circle | Square): number {
  return s.kind === "square" ? s.edge * s.edge : s.radius * 3;
}

function describe(s: Circle | Square): string {
  switch (s.kind) {
    case "circle":
      return "circle " + s.radius;
    case "square":
      return "square " + s.edge + " " + s.corner;
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += area(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", sum);
const odd = make();
say("kind", odd.kind);
say("edge", odd.edge);
say("area", area(odd));
say("described", describe(odd));
say("is a square", odd instanceof Square);
odd.edge = 5;
say("area after a store", area(odd));
`,
    ),
    ...family(
      `each-route-alone/a-member-gets-another-kind-by-a-bound-function.ts	bind(c)(
each-route-alone/a-member-gets-another-kind-by-a-function-called-with-apply.ts	apply(c
each-route-alone/a-member-gets-another-kind-by-a-function-called-with-call.ts	call(c`,
      a => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Leaf {
  weight = 7;
}

class Cell {
  value: number | string = 1;
  leaf: Leaf | null = new Leaf();
  other = 5;
}

function storesToThis(this: Cell): void {
  this.value = "text";
  this.leaf = null;
}

function describe(c: Cell): string {
  const value = typeof c.value === "number" ? "number " + (c.value + 1) : "string " + c.value.length;
  const leaf = c.leaf === null ? "null" : "leaf " + c.leaf.weight;
  return value + ", " + leaf + ", " + c.other;
}

function change(c: Cell): void {
  storesToThis.${a});
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const c = new Cell();
  if (typeof c.value === "number" && c.leaf !== null) sum += c.value + c.leaf.weight;
}
say("honest rounds", sum);
const cell = new Cell();
say("before", describe(cell));
if (typeof cell.value === "number" && cell.leaf !== null) {
  change(cell);
  say("value", cell.value);
  say("value plus one", cell.value + 1);
  say("value doubled", cell.value * 2);
  say("leaf", cell.leaf === null ? "null" : "a leaf");
}
say("after", describe(cell));
say("a fresh cell", describe(new Cell()));
`,
    ),
    ...family(
      `each-route-alone/tag-stored-by-a-getter-defined-later.ts	Object.defineProperty(c, "kind", { get: () => "square"
each-route-alone/tag-stored-by-define-properties.ts	Object.defineProperties(c, { kind: { value: "square" }
each-route-alone/tag-stored-by-reflect-define-property.ts	Reflect.defineProperty(c, "kind", { value: "square"`,
      a => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  kind: "circle" = "circle";
  radius = 1;
}

class Square {
  kind: "square" = "square";
  edge = 2;
  corner = 90;
}

type Tagged = { kind: "circle" | "square" };

function retag(c: Circle): void {
  ${a} });
}

function area(s: Circle | Square): number {
  return s.kind === "square" ? s.edge * s.edge : s.radius * 3;
}

function describe(s: Circle | Square): string {
  switch (s.kind) {
    case "circle":
      return "circle " + s.radius;
    case "square":
      return "square " + s.edge + " " + s.corner;
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += area(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", sum);

const circle = new Circle();
say("before: area", area(circle));
say("before: described", describe(circle));
retag(circle);
say("after: kind", circle.kind);
say("after: area", area(circle));
say("after: described", describe(circle));
say("after: radius", circle.radius);
say("a fresh circle", describe(new Circle()));
say("a fresh square", describe(new Square()));
`,
    ),
    ...family(
      `each-route-alone/tag-stored-by-a-bound-function.ts	bind(c)(
each-route-alone/tag-stored-by-a-function-called-with-apply.ts	apply(c
each-route-alone/tag-stored-by-a-function-called-with-call.ts	call(c`,
      a => `function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  kind: "circle" = "circle";
  radius = 1;
}

class Square {
  kind: "square" = "square";
  edge = 2;
  corner = 90;
}

type Tagged = { kind: "circle" | "square" };

function storesToThis(this: Tagged): void {
  this.kind = "square";
}

function retag(c: Circle): void {
  storesToThis.${a});
}

function area(s: Circle | Square): number {
  return s.kind === "square" ? s.edge * s.edge : s.radius * 3;
}

function describe(s: Circle | Square): string {
  switch (s.kind) {
    case "circle":
      return "circle " + s.radius;
    case "square":
      return "square " + s.edge + " " + s.corner;
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += area(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", sum);

const circle = new Circle();
say("before: area", area(circle));
say("before: described", describe(circle));
retag(circle);
say("after: kind", circle.kind);
say("after: area", area(circle));
say("after: described", describe(circle));
say("after: radius", circle.radius);
say("a fresh circle", describe(new Circle()));
say("a fresh square", describe(new Square()));
`,
    ),
    "three-interfaces-that-some-of-300-literals-fit.ts": text(
      `// Three interfaces that every second, every third and every fifth of 300 object literals fit. No order of the literals puts the ones that fit each interface in a row, so a test for one of them looks a shape up in a set: a field and a parameter of each type take every literal that fits and turn every other one away, through a store by a computed name and through a call from untyped code.
interface Tagged {
  tag: number;
}

interface Named {
  label: number;
}

interface Sized {
  size: number;
}

class Holder {
  tagged: Tagged = { tag: -1 };
  named: Named = { label: -1 };
  sized: Sized = { size: -1 };
}

function makeAll(): unknown[] {
  return [`,
      [
        10,
        n => `    { tag: ${30 * n}, label: ${30 * n}, size: ${30 * n}, field${30 * n}: ${30 * n} },
    { field${30 * n + 1}: ${30 * n + 1} },
    { tag: ${30 * n + 2}, field${30 * n + 2}: ${30 * n + 2} },
    { label: ${30 * n + 3}, field${30 * n + 3}: ${30 * n + 3} },
    { tag: ${30 * n + 4}, field${30 * n + 4}: ${30 * n + 4} },
    { size: ${30 * n + 5}, field${30 * n + 5}: ${30 * n + 5} },
    { tag: ${30 * n + 6}, label: ${30 * n + 6}, field${30 * n + 6}: ${30 * n + 6} },
    { field${30 * n + 7}: ${30 * n + 7} },
    { tag: ${30 * n + 8}, field${30 * n + 8}: ${30 * n + 8} },
    { label: ${30 * n + 9}, field${30 * n + 9}: ${30 * n + 9} },
    { tag: ${30 * n + 10}, size: ${30 * n + 10}, field${30 * n + 10}: ${30 * n + 10} },
    { field${30 * n + 11}: ${30 * n + 11} },
    { tag: ${30 * n + 12}, label: ${30 * n + 12}, field${30 * n + 12}: ${30 * n + 12} },
    { field${30 * n + 13}: ${30 * n + 13} },
    { tag: ${30 * n + 14}, field${30 * n + 14}: ${30 * n + 14} },
    { label: ${30 * n + 15}, size: ${30 * n + 15}, field${30 * n + 15}: ${30 * n + 15} },
    { tag: ${30 * n + 16}, field${30 * n + 16}: ${30 * n + 16} },
    { field${30 * n + 17}: ${30 * n + 17} },
    { tag: ${30 * n + 18}, label: ${30 * n + 18}, field${30 * n + 18}: ${30 * n + 18} },
    { field${30 * n + 19}: ${30 * n + 19} },
    { tag: ${30 * n + 20}, size: ${30 * n + 20}, field${30 * n + 20}: ${30 * n + 20} },
    { label: ${30 * n + 21}, field${30 * n + 21}: ${30 * n + 21} },
    { tag: ${30 * n + 22}, field${30 * n + 22}: ${30 * n + 22} },
    { field${30 * n + 23}: ${30 * n + 23} },
    { tag: ${30 * n + 24}, label: ${30 * n + 24}, field${30 * n + 24}: ${30 * n + 24} },
    { size: ${30 * n + 25}, field${30 * n + 25}: ${30 * n + 25} },
    { tag: ${30 * n + 26}, field${30 * n + 26}: ${30 * n + 26} },
    { label: ${30 * n + 27}, field${30 * n + 27}: ${30 * n + 27} },
    { tag: ${30 * n + 28}, field${30 * n + 28}: ${30 * n + 28} },
    { field${30 * n + 29}: ${30 * n + 29} },`,
      ],
      `  ];
}

function tagOf(value: Tagged): number {
  return value.tag;
}

function labelOf(value: Named): number {
  return value.label;
}

function sizeOf(value: Sized): number {
  return value.size;
}

const all = makeAll();
const holder: any = new Holder();
const readers: any[] = [tagOf, labelOf, sizeOf];
const names = ["tag", "nam", "siz"].map(start => start + (start === "tag" ? "ged" : "ed"));

function mark(run: () => void): string {
  try {
    run();
    return "+";
  } catch (error) {
    return error instanceof TypeError ? "-" : "?";
  }
}

for (let round = 0; round < 3; round++) {
  for (let which = 0; which < 3; which++) {
    let stores = "";
    let calls = "";
    let sum = 0;
    for (const value of all) {
      stores += mark(() => {
        holder[names[which]] = value;
      });
      calls += mark(() => {
        sum += readers[which](value) | 0;
      });
    }
    console.log(names[which], stores);
    console.log(names[which], calls, sum);
  }
  const typed: Holder = holder;
  console.log(typed.tagged.tag | 0, typed.named.label | 0, typed.sized.size | 0);
}
`,
    ),
    "an-interface-for-each-row-and-column-of-1024-literals.ts": text(
      `// 1,024 object literals in a grid of 32 rows and 32 columns, an interface for each row, which its 32 literals fit, and one for each column, which the literals of every fourth row fit. Whichever of the two the shapes are numbered along, the literals that fit an interface of the other kind lie far apart: 8 shapes over a span of about 900. A field and a parameter of each of the 64 types take every literal, through a store by a computed name and through a call from untyped code.`,
      [
        32,
        n => `interface Row${n} {
  row${n}: number;
}`,
      ],
      [
        32,
        n => `interface Column${n} {
  column${n}: number;
}`,
      ],
      `
class Holder {`,
      [32, n => `  row${n}: Row${n} = { row${n}: -1 };`],
      [32, n => `  column${n}: Column${n} = { column${n}: -1 };`],
      `}

function makeAll(): unknown[] {
  const all: unknown[] = [];`,
      [
        2,
        n => `  all.push({ row${n}: ${33 * n}, column${n}: ${33 * n + 1} });
  all.push({ row${n}: ${33 * n + 1}, spare${n + 1}: ${33 * n + 2} });
  all.push({ row${n}: ${33 * n + 2}, spare${n + 2}: ${33 * n + 3} });
  all.push({ row${n}: ${33 * n + 3}, spare${n + 3}: ${33 * n + 4} });
  all.push({ row${n}: ${33 * n + 4}, column${n + 4}: ${33 * n + 5} });
  all.push({ row${n}: ${33 * n + 5}, spare${n + 5}: ${33 * n + 6} });
  all.push({ row${n}: ${33 * n + 6}, spare${n + 6}: ${33 * n + 7} });
  all.push({ row${n}: ${33 * n + 7}, spare${n + 7}: ${33 * n + 8} });
  all.push({ row${n}: ${33 * n + 8}, column${n + 8}: ${33 * n + 9} });
  all.push({ row${n}: ${33 * n + 9}, spare${n + 9}: ${33 * n + 10} });
  all.push({ row${n}: ${33 * n + 10}, spare${n + 10}: ${33 * n + 11} });
  all.push({ row${n}: ${33 * n + 11}, spare${n + 11}: ${33 * n + 12} });
  all.push({ row${n}: ${33 * n + 12}, column${n + 12}: ${33 * n + 13} });
  all.push({ row${n}: ${33 * n + 13}, spare${n + 13}: ${33 * n + 14} });
  all.push({ row${n}: ${33 * n + 14}, spare${n + 14}: ${33 * n + 15} });
  all.push({ row${n}: ${33 * n + 15}, spare${n + 15}: ${33 * n + 16} });
  all.push({ row${n}: ${33 * n + 16}, column${n + 16}: ${33 * n + 17} });
  all.push({ row${n}: ${33 * n + 17}, spare${n + 17}: ${33 * n + 18} });
  all.push({ row${n}: ${33 * n + 18}, spare${n + 18}: ${33 * n + 19} });
  all.push({ row${n}: ${33 * n + 19}, spare${n + 19}: ${33 * n + 20} });
  all.push({ row${n}: ${33 * n + 20}, column${n + 20}: ${33 * n + 21} });
  all.push({ row${n}: ${33 * n + 21}, spare${n + 21}: ${33 * n + 22} });
  all.push({ row${n}: ${33 * n + 22}, spare${n + 22}: ${33 * n + 23} });
  all.push({ row${n}: ${33 * n + 23}, spare${n + 23}: ${33 * n + 24} });
  all.push({ row${n}: ${33 * n + 24}, column${n + 24}: ${33 * n + 25} });
  all.push({ row${n}: ${33 * n + 25}, spare${n + 25}: ${33 * n + 26} });
  all.push({ row${n}: ${33 * n + 26}, spare${n + 26}: ${33 * n + 27} });
  all.push({ row${n}: ${33 * n + 27}, spare${n + 27}: ${33 * n + 28} });
  all.push({ row${n}: ${33 * n + 28}, column${n + 28}: ${33 * n + 29} });
  all.push({ row${n}: ${33 * n + 29}, spare${n + 29}: ${33 * n + 30} });
  all.push({ row${n}: ${33 * n + 30}, spare${n + 30}: ${33 * n + 31} });
  all.push({ row${2 * n}: ${33 * n + 31}, spare${31 - 31 * n}: ${33 * n + 32} });
  all.push({ row${n + 1}: ${33 * n + 32}, spare${n}: ${33 * n + 33} });`,
      ],
      [
        7,
        n => `  all.push({ row2: ${4 * n + 66}, column${4 * n + 2}: ${4 * n + 67} });
  all.push({ row2: ${4 * n + 67}, spare${4 * n + 3}: ${4 * n + 68} });
  all.push({ row2: ${4 * n + 68}, spare${4 * n + 4}: ${4 * n + 69} });
  all.push({ row2: ${4 * n + 69}, spare${4 * n + 5}: ${4 * n + 70} });`,
      ],
      `  all.push({ row2: 94, column30: 95 });
  all.push({ row2: 95, spare31: 96 });`,
      [
        8,
        n => `  all.push({ row3: ${4 * n + 96}, spare${4 * n}: ${4 * n + 97} });
  all.push({ row3: ${4 * n + 97}, spare${4 * n + 1}: ${4 * n + 98} });
  all.push({ row3: ${4 * n + 98}, spare${4 * n + 2}: ${4 * n + 99} });
  all.push({ row3: ${4 * n + 99}, column${4 * n + 3}: ${4 * n + 100} });`,
      ],
      [
        2,
        n => `  all.push({ row${n + 4}: ${33 * n + 128}, column${n}: ${33 * n + 129} });
  all.push({ row${n + 4}: ${33 * n + 129}, spare${n + 1}: ${33 * n + 130} });
  all.push({ row${n + 4}: ${33 * n + 130}, spare${n + 2}: ${33 * n + 131} });
  all.push({ row${n + 4}: ${33 * n + 131}, spare${n + 3}: ${33 * n + 132} });
  all.push({ row${n + 4}: ${33 * n + 132}, column${n + 4}: ${33 * n + 133} });
  all.push({ row${n + 4}: ${33 * n + 133}, spare${n + 5}: ${33 * n + 134} });
  all.push({ row${n + 4}: ${33 * n + 134}, spare${n + 6}: ${33 * n + 135} });
  all.push({ row${n + 4}: ${33 * n + 135}, spare${n + 7}: ${33 * n + 136} });
  all.push({ row${n + 4}: ${33 * n + 136}, column${n + 8}: ${33 * n + 137} });
  all.push({ row${n + 4}: ${33 * n + 137}, spare${n + 9}: ${33 * n + 138} });
  all.push({ row${n + 4}: ${33 * n + 138}, spare${n + 10}: ${33 * n + 139} });
  all.push({ row${n + 4}: ${33 * n + 139}, spare${n + 11}: ${33 * n + 140} });
  all.push({ row${n + 4}: ${33 * n + 140}, column${n + 12}: ${33 * n + 141} });
  all.push({ row${n + 4}: ${33 * n + 141}, spare${n + 13}: ${33 * n + 142} });
  all.push({ row${n + 4}: ${33 * n + 142}, spare${n + 14}: ${33 * n + 143} });
  all.push({ row${n + 4}: ${33 * n + 143}, spare${n + 15}: ${33 * n + 144} });
  all.push({ row${n + 4}: ${33 * n + 144}, column${n + 16}: ${33 * n + 145} });
  all.push({ row${n + 4}: ${33 * n + 145}, spare${n + 17}: ${33 * n + 146} });
  all.push({ row${n + 4}: ${33 * n + 146}, spare${n + 18}: ${33 * n + 147} });
  all.push({ row${n + 4}: ${33 * n + 147}, spare${n + 19}: ${33 * n + 148} });
  all.push({ row${n + 4}: ${33 * n + 148}, column${n + 20}: ${33 * n + 149} });
  all.push({ row${n + 4}: ${33 * n + 149}, spare${n + 21}: ${33 * n + 150} });
  all.push({ row${n + 4}: ${33 * n + 150}, spare${n + 22}: ${33 * n + 151} });
  all.push({ row${n + 4}: ${33 * n + 151}, spare${n + 23}: ${33 * n + 152} });
  all.push({ row${n + 4}: ${33 * n + 152}, column${n + 24}: ${33 * n + 153} });
  all.push({ row${n + 4}: ${33 * n + 153}, spare${n + 25}: ${33 * n + 154} });
  all.push({ row${n + 4}: ${33 * n + 154}, spare${n + 26}: ${33 * n + 155} });
  all.push({ row${n + 4}: ${33 * n + 155}, spare${n + 27}: ${33 * n + 156} });
  all.push({ row${n + 4}: ${33 * n + 156}, column${n + 28}: ${33 * n + 157} });
  all.push({ row${n + 4}: ${33 * n + 157}, spare${n + 29}: ${33 * n + 158} });
  all.push({ row${n + 4}: ${33 * n + 158}, spare${n + 30}: ${33 * n + 159} });
  all.push({ row${2 * n + 4}: ${33 * n + 159}, spare${31 - 31 * n}: ${33 * n + 160} });
  all.push({ row${n + 5}: ${33 * n + 160}, spare${n}: ${33 * n + 161} });`,
      ],
      [
        7,
        n => `  all.push({ row6: ${4 * n + 194}, column${4 * n + 2}: ${4 * n + 195} });
  all.push({ row6: ${4 * n + 195}, spare${4 * n + 3}: ${4 * n + 196} });
  all.push({ row6: ${4 * n + 196}, spare${4 * n + 4}: ${4 * n + 197} });
  all.push({ row6: ${4 * n + 197}, spare${4 * n + 5}: ${4 * n + 198} });`,
      ],
      `  all.push({ row6: 222, column30: 223 });
  all.push({ row6: 223, spare31: 224 });`,
      [
        8,
        n => `  all.push({ row7: ${4 * n + 224}, spare${4 * n}: ${4 * n + 225} });
  all.push({ row7: ${4 * n + 225}, spare${4 * n + 1}: ${4 * n + 226} });
  all.push({ row7: ${4 * n + 226}, spare${4 * n + 2}: ${4 * n + 227} });
  all.push({ row7: ${4 * n + 227}, column${4 * n + 3}: ${4 * n + 228} });`,
      ],
      [
        2,
        n => `  all.push({ row${n + 8}: ${33 * n + 256}, column${n}: ${33 * n + 257} });
  all.push({ row${n + 8}: ${33 * n + 257}, spare${n + 1}: ${33 * n + 258} });
  all.push({ row${n + 8}: ${33 * n + 258}, spare${n + 2}: ${33 * n + 259} });
  all.push({ row${n + 8}: ${33 * n + 259}, spare${n + 3}: ${33 * n + 260} });
  all.push({ row${n + 8}: ${33 * n + 260}, column${n + 4}: ${33 * n + 261} });
  all.push({ row${n + 8}: ${33 * n + 261}, spare${n + 5}: ${33 * n + 262} });
  all.push({ row${n + 8}: ${33 * n + 262}, spare${n + 6}: ${33 * n + 263} });
  all.push({ row${n + 8}: ${33 * n + 263}, spare${n + 7}: ${33 * n + 264} });
  all.push({ row${n + 8}: ${33 * n + 264}, column${n + 8}: ${33 * n + 265} });
  all.push({ row${n + 8}: ${33 * n + 265}, spare${n + 9}: ${33 * n + 266} });
  all.push({ row${n + 8}: ${33 * n + 266}, spare${n + 10}: ${33 * n + 267} });
  all.push({ row${n + 8}: ${33 * n + 267}, spare${n + 11}: ${33 * n + 268} });
  all.push({ row${n + 8}: ${33 * n + 268}, column${n + 12}: ${33 * n + 269} });
  all.push({ row${n + 8}: ${33 * n + 269}, spare${n + 13}: ${33 * n + 270} });
  all.push({ row${n + 8}: ${33 * n + 270}, spare${n + 14}: ${33 * n + 271} });
  all.push({ row${n + 8}: ${33 * n + 271}, spare${n + 15}: ${33 * n + 272} });
  all.push({ row${n + 8}: ${33 * n + 272}, column${n + 16}: ${33 * n + 273} });
  all.push({ row${n + 8}: ${33 * n + 273}, spare${n + 17}: ${33 * n + 274} });
  all.push({ row${n + 8}: ${33 * n + 274}, spare${n + 18}: ${33 * n + 275} });
  all.push({ row${n + 8}: ${33 * n + 275}, spare${n + 19}: ${33 * n + 276} });
  all.push({ row${n + 8}: ${33 * n + 276}, column${n + 20}: ${33 * n + 277} });
  all.push({ row${n + 8}: ${33 * n + 277}, spare${n + 21}: ${33 * n + 278} });
  all.push({ row${n + 8}: ${33 * n + 278}, spare${n + 22}: ${33 * n + 279} });
  all.push({ row${n + 8}: ${33 * n + 279}, spare${n + 23}: ${33 * n + 280} });
  all.push({ row${n + 8}: ${33 * n + 280}, column${n + 24}: ${33 * n + 281} });
  all.push({ row${n + 8}: ${33 * n + 281}, spare${n + 25}: ${33 * n + 282} });
  all.push({ row${n + 8}: ${33 * n + 282}, spare${n + 26}: ${33 * n + 283} });
  all.push({ row${n + 8}: ${33 * n + 283}, spare${n + 27}: ${33 * n + 284} });
  all.push({ row${n + 8}: ${33 * n + 284}, column${n + 28}: ${33 * n + 285} });
  all.push({ row${n + 8}: ${33 * n + 285}, spare${n + 29}: ${33 * n + 286} });
  all.push({ row${n + 8}: ${33 * n + 286}, spare${n + 30}: ${33 * n + 287} });
  all.push({ row${2 * n + 8}: ${33 * n + 287}, spare${31 - 31 * n}: ${33 * n + 288} });
  all.push({ row${n + 9}: ${33 * n + 288}, spare${n}: ${33 * n + 289} });`,
      ],
      [
        7,
        n => `  all.push({ row10: ${4 * n + 322}, column${4 * n + 2}: ${4 * n + 323} });
  all.push({ row10: ${4 * n + 323}, spare${4 * n + 3}: ${4 * n + 324} });
  all.push({ row10: ${4 * n + 324}, spare${4 * n + 4}: ${4 * n + 325} });
  all.push({ row10: ${4 * n + 325}, spare${4 * n + 5}: ${4 * n + 326} });`,
      ],
      `  all.push({ row10: 350, column30: 351 });
  all.push({ row10: 351, spare31: 352 });`,
      [
        8,
        n => `  all.push({ row11: ${4 * n + 352}, spare${4 * n}: ${4 * n + 353} });
  all.push({ row11: ${4 * n + 353}, spare${4 * n + 1}: ${4 * n + 354} });
  all.push({ row11: ${4 * n + 354}, spare${4 * n + 2}: ${4 * n + 355} });
  all.push({ row11: ${4 * n + 355}, column${4 * n + 3}: ${4 * n + 356} });`,
      ],
      [
        2,
        n => `  all.push({ row${n + 12}: ${33 * n + 384}, column${n}: ${33 * n + 385} });
  all.push({ row${n + 12}: ${33 * n + 385}, spare${n + 1}: ${33 * n + 386} });
  all.push({ row${n + 12}: ${33 * n + 386}, spare${n + 2}: ${33 * n + 387} });
  all.push({ row${n + 12}: ${33 * n + 387}, spare${n + 3}: ${33 * n + 388} });
  all.push({ row${n + 12}: ${33 * n + 388}, column${n + 4}: ${33 * n + 389} });
  all.push({ row${n + 12}: ${33 * n + 389}, spare${n + 5}: ${33 * n + 390} });
  all.push({ row${n + 12}: ${33 * n + 390}, spare${n + 6}: ${33 * n + 391} });
  all.push({ row${n + 12}: ${33 * n + 391}, spare${n + 7}: ${33 * n + 392} });
  all.push({ row${n + 12}: ${33 * n + 392}, column${n + 8}: ${33 * n + 393} });
  all.push({ row${n + 12}: ${33 * n + 393}, spare${n + 9}: ${33 * n + 394} });
  all.push({ row${n + 12}: ${33 * n + 394}, spare${n + 10}: ${33 * n + 395} });
  all.push({ row${n + 12}: ${33 * n + 395}, spare${n + 11}: ${33 * n + 396} });
  all.push({ row${n + 12}: ${33 * n + 396}, column${n + 12}: ${33 * n + 397} });
  all.push({ row${n + 12}: ${33 * n + 397}, spare${n + 13}: ${33 * n + 398} });
  all.push({ row${n + 12}: ${33 * n + 398}, spare${n + 14}: ${33 * n + 399} });
  all.push({ row${n + 12}: ${33 * n + 399}, spare${n + 15}: ${33 * n + 400} });
  all.push({ row${n + 12}: ${33 * n + 400}, column${n + 16}: ${33 * n + 401} });
  all.push({ row${n + 12}: ${33 * n + 401}, spare${n + 17}: ${33 * n + 402} });
  all.push({ row${n + 12}: ${33 * n + 402}, spare${n + 18}: ${33 * n + 403} });
  all.push({ row${n + 12}: ${33 * n + 403}, spare${n + 19}: ${33 * n + 404} });
  all.push({ row${n + 12}: ${33 * n + 404}, column${n + 20}: ${33 * n + 405} });
  all.push({ row${n + 12}: ${33 * n + 405}, spare${n + 21}: ${33 * n + 406} });
  all.push({ row${n + 12}: ${33 * n + 406}, spare${n + 22}: ${33 * n + 407} });
  all.push({ row${n + 12}: ${33 * n + 407}, spare${n + 23}: ${33 * n + 408} });
  all.push({ row${n + 12}: ${33 * n + 408}, column${n + 24}: ${33 * n + 409} });
  all.push({ row${n + 12}: ${33 * n + 409}, spare${n + 25}: ${33 * n + 410} });
  all.push({ row${n + 12}: ${33 * n + 410}, spare${n + 26}: ${33 * n + 411} });
  all.push({ row${n + 12}: ${33 * n + 411}, spare${n + 27}: ${33 * n + 412} });
  all.push({ row${n + 12}: ${33 * n + 412}, column${n + 28}: ${33 * n + 413} });
  all.push({ row${n + 12}: ${33 * n + 413}, spare${n + 29}: ${33 * n + 414} });
  all.push({ row${n + 12}: ${33 * n + 414}, spare${n + 30}: ${33 * n + 415} });
  all.push({ row${2 * n + 12}: ${33 * n + 415}, spare${31 - 31 * n}: ${33 * n + 416} });
  all.push({ row${n + 13}: ${33 * n + 416}, spare${n}: ${33 * n + 417} });`,
      ],
      [
        7,
        n => `  all.push({ row14: ${4 * n + 450}, column${4 * n + 2}: ${4 * n + 451} });
  all.push({ row14: ${4 * n + 451}, spare${4 * n + 3}: ${4 * n + 452} });
  all.push({ row14: ${4 * n + 452}, spare${4 * n + 4}: ${4 * n + 453} });
  all.push({ row14: ${4 * n + 453}, spare${4 * n + 5}: ${4 * n + 454} });`,
      ],
      `  all.push({ row14: 478, column30: 479 });
  all.push({ row14: 479, spare31: 480 });`,
      [
        8,
        n => `  all.push({ row15: ${4 * n + 480}, spare${4 * n}: ${4 * n + 481} });
  all.push({ row15: ${4 * n + 481}, spare${4 * n + 1}: ${4 * n + 482} });
  all.push({ row15: ${4 * n + 482}, spare${4 * n + 2}: ${4 * n + 483} });
  all.push({ row15: ${4 * n + 483}, column${4 * n + 3}: ${4 * n + 484} });`,
      ],
      [
        2,
        n => `  all.push({ row${n + 16}: ${33 * n + 512}, column${n}: ${33 * n + 513} });
  all.push({ row${n + 16}: ${33 * n + 513}, spare${n + 1}: ${33 * n + 514} });
  all.push({ row${n + 16}: ${33 * n + 514}, spare${n + 2}: ${33 * n + 515} });
  all.push({ row${n + 16}: ${33 * n + 515}, spare${n + 3}: ${33 * n + 516} });
  all.push({ row${n + 16}: ${33 * n + 516}, column${n + 4}: ${33 * n + 517} });
  all.push({ row${n + 16}: ${33 * n + 517}, spare${n + 5}: ${33 * n + 518} });
  all.push({ row${n + 16}: ${33 * n + 518}, spare${n + 6}: ${33 * n + 519} });
  all.push({ row${n + 16}: ${33 * n + 519}, spare${n + 7}: ${33 * n + 520} });
  all.push({ row${n + 16}: ${33 * n + 520}, column${n + 8}: ${33 * n + 521} });
  all.push({ row${n + 16}: ${33 * n + 521}, spare${n + 9}: ${33 * n + 522} });
  all.push({ row${n + 16}: ${33 * n + 522}, spare${n + 10}: ${33 * n + 523} });
  all.push({ row${n + 16}: ${33 * n + 523}, spare${n + 11}: ${33 * n + 524} });
  all.push({ row${n + 16}: ${33 * n + 524}, column${n + 12}: ${33 * n + 525} });
  all.push({ row${n + 16}: ${33 * n + 525}, spare${n + 13}: ${33 * n + 526} });
  all.push({ row${n + 16}: ${33 * n + 526}, spare${n + 14}: ${33 * n + 527} });
  all.push({ row${n + 16}: ${33 * n + 527}, spare${n + 15}: ${33 * n + 528} });
  all.push({ row${n + 16}: ${33 * n + 528}, column${n + 16}: ${33 * n + 529} });
  all.push({ row${n + 16}: ${33 * n + 529}, spare${n + 17}: ${33 * n + 530} });
  all.push({ row${n + 16}: ${33 * n + 530}, spare${n + 18}: ${33 * n + 531} });
  all.push({ row${n + 16}: ${33 * n + 531}, spare${n + 19}: ${33 * n + 532} });
  all.push({ row${n + 16}: ${33 * n + 532}, column${n + 20}: ${33 * n + 533} });
  all.push({ row${n + 16}: ${33 * n + 533}, spare${n + 21}: ${33 * n + 534} });
  all.push({ row${n + 16}: ${33 * n + 534}, spare${n + 22}: ${33 * n + 535} });
  all.push({ row${n + 16}: ${33 * n + 535}, spare${n + 23}: ${33 * n + 536} });
  all.push({ row${n + 16}: ${33 * n + 536}, column${n + 24}: ${33 * n + 537} });
  all.push({ row${n + 16}: ${33 * n + 537}, spare${n + 25}: ${33 * n + 538} });
  all.push({ row${n + 16}: ${33 * n + 538}, spare${n + 26}: ${33 * n + 539} });
  all.push({ row${n + 16}: ${33 * n + 539}, spare${n + 27}: ${33 * n + 540} });
  all.push({ row${n + 16}: ${33 * n + 540}, column${n + 28}: ${33 * n + 541} });
  all.push({ row${n + 16}: ${33 * n + 541}, spare${n + 29}: ${33 * n + 542} });
  all.push({ row${n + 16}: ${33 * n + 542}, spare${n + 30}: ${33 * n + 543} });
  all.push({ row${2 * n + 16}: ${33 * n + 543}, spare${31 - 31 * n}: ${33 * n + 544} });
  all.push({ row${n + 17}: ${33 * n + 544}, spare${n}: ${33 * n + 545} });`,
      ],
      [
        7,
        n => `  all.push({ row18: ${4 * n + 578}, column${4 * n + 2}: ${4 * n + 579} });
  all.push({ row18: ${4 * n + 579}, spare${4 * n + 3}: ${4 * n + 580} });
  all.push({ row18: ${4 * n + 580}, spare${4 * n + 4}: ${4 * n + 581} });
  all.push({ row18: ${4 * n + 581}, spare${4 * n + 5}: ${4 * n + 582} });`,
      ],
      `  all.push({ row18: 606, column30: 607 });
  all.push({ row18: 607, spare31: 608 });`,
      [
        8,
        n => `  all.push({ row19: ${4 * n + 608}, spare${4 * n}: ${4 * n + 609} });
  all.push({ row19: ${4 * n + 609}, spare${4 * n + 1}: ${4 * n + 610} });
  all.push({ row19: ${4 * n + 610}, spare${4 * n + 2}: ${4 * n + 611} });
  all.push({ row19: ${4 * n + 611}, column${4 * n + 3}: ${4 * n + 612} });`,
      ],
      [
        2,
        n => `  all.push({ row${n + 20}: ${33 * n + 640}, column${n}: ${33 * n + 641} });
  all.push({ row${n + 20}: ${33 * n + 641}, spare${n + 1}: ${33 * n + 642} });
  all.push({ row${n + 20}: ${33 * n + 642}, spare${n + 2}: ${33 * n + 643} });
  all.push({ row${n + 20}: ${33 * n + 643}, spare${n + 3}: ${33 * n + 644} });
  all.push({ row${n + 20}: ${33 * n + 644}, column${n + 4}: ${33 * n + 645} });
  all.push({ row${n + 20}: ${33 * n + 645}, spare${n + 5}: ${33 * n + 646} });
  all.push({ row${n + 20}: ${33 * n + 646}, spare${n + 6}: ${33 * n + 647} });
  all.push({ row${n + 20}: ${33 * n + 647}, spare${n + 7}: ${33 * n + 648} });
  all.push({ row${n + 20}: ${33 * n + 648}, column${n + 8}: ${33 * n + 649} });
  all.push({ row${n + 20}: ${33 * n + 649}, spare${n + 9}: ${33 * n + 650} });
  all.push({ row${n + 20}: ${33 * n + 650}, spare${n + 10}: ${33 * n + 651} });
  all.push({ row${n + 20}: ${33 * n + 651}, spare${n + 11}: ${33 * n + 652} });
  all.push({ row${n + 20}: ${33 * n + 652}, column${n + 12}: ${33 * n + 653} });
  all.push({ row${n + 20}: ${33 * n + 653}, spare${n + 13}: ${33 * n + 654} });
  all.push({ row${n + 20}: ${33 * n + 654}, spare${n + 14}: ${33 * n + 655} });
  all.push({ row${n + 20}: ${33 * n + 655}, spare${n + 15}: ${33 * n + 656} });
  all.push({ row${n + 20}: ${33 * n + 656}, column${n + 16}: ${33 * n + 657} });
  all.push({ row${n + 20}: ${33 * n + 657}, spare${n + 17}: ${33 * n + 658} });
  all.push({ row${n + 20}: ${33 * n + 658}, spare${n + 18}: ${33 * n + 659} });
  all.push({ row${n + 20}: ${33 * n + 659}, spare${n + 19}: ${33 * n + 660} });
  all.push({ row${n + 20}: ${33 * n + 660}, column${n + 20}: ${33 * n + 661} });
  all.push({ row${n + 20}: ${33 * n + 661}, spare${n + 21}: ${33 * n + 662} });
  all.push({ row${n + 20}: ${33 * n + 662}, spare${n + 22}: ${33 * n + 663} });
  all.push({ row${n + 20}: ${33 * n + 663}, spare${n + 23}: ${33 * n + 664} });
  all.push({ row${n + 20}: ${33 * n + 664}, column${n + 24}: ${33 * n + 665} });
  all.push({ row${n + 20}: ${33 * n + 665}, spare${n + 25}: ${33 * n + 666} });
  all.push({ row${n + 20}: ${33 * n + 666}, spare${n + 26}: ${33 * n + 667} });
  all.push({ row${n + 20}: ${33 * n + 667}, spare${n + 27}: ${33 * n + 668} });
  all.push({ row${n + 20}: ${33 * n + 668}, column${n + 28}: ${33 * n + 669} });
  all.push({ row${n + 20}: ${33 * n + 669}, spare${n + 29}: ${33 * n + 670} });
  all.push({ row${n + 20}: ${33 * n + 670}, spare${n + 30}: ${33 * n + 671} });
  all.push({ row${2 * n + 20}: ${33 * n + 671}, spare${31 - 31 * n}: ${33 * n + 672} });
  all.push({ row${n + 21}: ${33 * n + 672}, spare${n}: ${33 * n + 673} });`,
      ],
      [
        7,
        n => `  all.push({ row22: ${4 * n + 706}, column${4 * n + 2}: ${4 * n + 707} });
  all.push({ row22: ${4 * n + 707}, spare${4 * n + 3}: ${4 * n + 708} });
  all.push({ row22: ${4 * n + 708}, spare${4 * n + 4}: ${4 * n + 709} });
  all.push({ row22: ${4 * n + 709}, spare${4 * n + 5}: ${4 * n + 710} });`,
      ],
      `  all.push({ row22: 734, column30: 735 });
  all.push({ row22: 735, spare31: 736 });`,
      [
        8,
        n => `  all.push({ row23: ${4 * n + 736}, spare${4 * n}: ${4 * n + 737} });
  all.push({ row23: ${4 * n + 737}, spare${4 * n + 1}: ${4 * n + 738} });
  all.push({ row23: ${4 * n + 738}, spare${4 * n + 2}: ${4 * n + 739} });
  all.push({ row23: ${4 * n + 739}, column${4 * n + 3}: ${4 * n + 740} });`,
      ],
      [
        2,
        n => `  all.push({ row${n + 24}: ${33 * n + 768}, column${n}: ${33 * n + 769} });
  all.push({ row${n + 24}: ${33 * n + 769}, spare${n + 1}: ${33 * n + 770} });
  all.push({ row${n + 24}: ${33 * n + 770}, spare${n + 2}: ${33 * n + 771} });
  all.push({ row${n + 24}: ${33 * n + 771}, spare${n + 3}: ${33 * n + 772} });
  all.push({ row${n + 24}: ${33 * n + 772}, column${n + 4}: ${33 * n + 773} });
  all.push({ row${n + 24}: ${33 * n + 773}, spare${n + 5}: ${33 * n + 774} });
  all.push({ row${n + 24}: ${33 * n + 774}, spare${n + 6}: ${33 * n + 775} });
  all.push({ row${n + 24}: ${33 * n + 775}, spare${n + 7}: ${33 * n + 776} });
  all.push({ row${n + 24}: ${33 * n + 776}, column${n + 8}: ${33 * n + 777} });
  all.push({ row${n + 24}: ${33 * n + 777}, spare${n + 9}: ${33 * n + 778} });
  all.push({ row${n + 24}: ${33 * n + 778}, spare${n + 10}: ${33 * n + 779} });
  all.push({ row${n + 24}: ${33 * n + 779}, spare${n + 11}: ${33 * n + 780} });
  all.push({ row${n + 24}: ${33 * n + 780}, column${n + 12}: ${33 * n + 781} });
  all.push({ row${n + 24}: ${33 * n + 781}, spare${n + 13}: ${33 * n + 782} });
  all.push({ row${n + 24}: ${33 * n + 782}, spare${n + 14}: ${33 * n + 783} });
  all.push({ row${n + 24}: ${33 * n + 783}, spare${n + 15}: ${33 * n + 784} });
  all.push({ row${n + 24}: ${33 * n + 784}, column${n + 16}: ${33 * n + 785} });
  all.push({ row${n + 24}: ${33 * n + 785}, spare${n + 17}: ${33 * n + 786} });
  all.push({ row${n + 24}: ${33 * n + 786}, spare${n + 18}: ${33 * n + 787} });
  all.push({ row${n + 24}: ${33 * n + 787}, spare${n + 19}: ${33 * n + 788} });
  all.push({ row${n + 24}: ${33 * n + 788}, column${n + 20}: ${33 * n + 789} });
  all.push({ row${n + 24}: ${33 * n + 789}, spare${n + 21}: ${33 * n + 790} });
  all.push({ row${n + 24}: ${33 * n + 790}, spare${n + 22}: ${33 * n + 791} });
  all.push({ row${n + 24}: ${33 * n + 791}, spare${n + 23}: ${33 * n + 792} });
  all.push({ row${n + 24}: ${33 * n + 792}, column${n + 24}: ${33 * n + 793} });
  all.push({ row${n + 24}: ${33 * n + 793}, spare${n + 25}: ${33 * n + 794} });
  all.push({ row${n + 24}: ${33 * n + 794}, spare${n + 26}: ${33 * n + 795} });
  all.push({ row${n + 24}: ${33 * n + 795}, spare${n + 27}: ${33 * n + 796} });
  all.push({ row${n + 24}: ${33 * n + 796}, column${n + 28}: ${33 * n + 797} });
  all.push({ row${n + 24}: ${33 * n + 797}, spare${n + 29}: ${33 * n + 798} });
  all.push({ row${n + 24}: ${33 * n + 798}, spare${n + 30}: ${33 * n + 799} });
  all.push({ row${2 * n + 24}: ${33 * n + 799}, spare${31 - 31 * n}: ${33 * n + 800} });
  all.push({ row${n + 25}: ${33 * n + 800}, spare${n}: ${33 * n + 801} });`,
      ],
      [
        7,
        n => `  all.push({ row26: ${4 * n + 834}, column${4 * n + 2}: ${4 * n + 835} });
  all.push({ row26: ${4 * n + 835}, spare${4 * n + 3}: ${4 * n + 836} });
  all.push({ row26: ${4 * n + 836}, spare${4 * n + 4}: ${4 * n + 837} });
  all.push({ row26: ${4 * n + 837}, spare${4 * n + 5}: ${4 * n + 838} });`,
      ],
      `  all.push({ row26: 862, column30: 863 });
  all.push({ row26: 863, spare31: 864 });`,
      [
        8,
        n => `  all.push({ row27: ${4 * n + 864}, spare${4 * n}: ${4 * n + 865} });
  all.push({ row27: ${4 * n + 865}, spare${4 * n + 1}: ${4 * n + 866} });
  all.push({ row27: ${4 * n + 866}, spare${4 * n + 2}: ${4 * n + 867} });
  all.push({ row27: ${4 * n + 867}, column${4 * n + 3}: ${4 * n + 868} });`,
      ],
      [
        2,
        n => `  all.push({ row${n + 28}: ${33 * n + 896}, column${n}: ${33 * n + 897} });
  all.push({ row${n + 28}: ${33 * n + 897}, spare${n + 1}: ${33 * n + 898} });
  all.push({ row${n + 28}: ${33 * n + 898}, spare${n + 2}: ${33 * n + 899} });
  all.push({ row${n + 28}: ${33 * n + 899}, spare${n + 3}: ${33 * n + 900} });
  all.push({ row${n + 28}: ${33 * n + 900}, column${n + 4}: ${33 * n + 901} });
  all.push({ row${n + 28}: ${33 * n + 901}, spare${n + 5}: ${33 * n + 902} });
  all.push({ row${n + 28}: ${33 * n + 902}, spare${n + 6}: ${33 * n + 903} });
  all.push({ row${n + 28}: ${33 * n + 903}, spare${n + 7}: ${33 * n + 904} });
  all.push({ row${n + 28}: ${33 * n + 904}, column${n + 8}: ${33 * n + 905} });
  all.push({ row${n + 28}: ${33 * n + 905}, spare${n + 9}: ${33 * n + 906} });
  all.push({ row${n + 28}: ${33 * n + 906}, spare${n + 10}: ${33 * n + 907} });
  all.push({ row${n + 28}: ${33 * n + 907}, spare${n + 11}: ${33 * n + 908} });
  all.push({ row${n + 28}: ${33 * n + 908}, column${n + 12}: ${33 * n + 909} });
  all.push({ row${n + 28}: ${33 * n + 909}, spare${n + 13}: ${33 * n + 910} });
  all.push({ row${n + 28}: ${33 * n + 910}, spare${n + 14}: ${33 * n + 911} });
  all.push({ row${n + 28}: ${33 * n + 911}, spare${n + 15}: ${33 * n + 912} });
  all.push({ row${n + 28}: ${33 * n + 912}, column${n + 16}: ${33 * n + 913} });
  all.push({ row${n + 28}: ${33 * n + 913}, spare${n + 17}: ${33 * n + 914} });
  all.push({ row${n + 28}: ${33 * n + 914}, spare${n + 18}: ${33 * n + 915} });
  all.push({ row${n + 28}: ${33 * n + 915}, spare${n + 19}: ${33 * n + 916} });
  all.push({ row${n + 28}: ${33 * n + 916}, column${n + 20}: ${33 * n + 917} });
  all.push({ row${n + 28}: ${33 * n + 917}, spare${n + 21}: ${33 * n + 918} });
  all.push({ row${n + 28}: ${33 * n + 918}, spare${n + 22}: ${33 * n + 919} });
  all.push({ row${n + 28}: ${33 * n + 919}, spare${n + 23}: ${33 * n + 920} });
  all.push({ row${n + 28}: ${33 * n + 920}, column${n + 24}: ${33 * n + 921} });
  all.push({ row${n + 28}: ${33 * n + 921}, spare${n + 25}: ${33 * n + 922} });
  all.push({ row${n + 28}: ${33 * n + 922}, spare${n + 26}: ${33 * n + 923} });
  all.push({ row${n + 28}: ${33 * n + 923}, spare${n + 27}: ${33 * n + 924} });
  all.push({ row${n + 28}: ${33 * n + 924}, column${n + 28}: ${33 * n + 925} });
  all.push({ row${n + 28}: ${33 * n + 925}, spare${n + 29}: ${33 * n + 926} });
  all.push({ row${n + 28}: ${33 * n + 926}, spare${n + 30}: ${33 * n + 927} });
  all.push({ row${2 * n + 28}: ${33 * n + 927}, spare${31 - 31 * n}: ${33 * n + 928} });
  all.push({ row${n + 29}: ${33 * n + 928}, spare${n}: ${33 * n + 929} });`,
      ],
      [
        7,
        n => `  all.push({ row30: ${4 * n + 962}, column${4 * n + 2}: ${4 * n + 963} });
  all.push({ row30: ${4 * n + 963}, spare${4 * n + 3}: ${4 * n + 964} });
  all.push({ row30: ${4 * n + 964}, spare${4 * n + 4}: ${4 * n + 965} });
  all.push({ row30: ${4 * n + 965}, spare${4 * n + 5}: ${4 * n + 966} });`,
      ],
      `  all.push({ row30: 990, column30: 991 });
  all.push({ row30: 991, spare31: 992 });`,
      [
        8,
        n => `  all.push({ row31: ${4 * n + 992}, spare${4 * n}: ${4 * n + 993} });
  all.push({ row31: ${4 * n + 993}, spare${4 * n + 1}: ${4 * n + 994} });
  all.push({ row31: ${4 * n + 994}, spare${4 * n + 2}: ${4 * n + 995} });
  all.push({ row31: ${4 * n + 995}, column${4 * n + 3}: ${4 * n + 996} });`,
      ],
      `  return all;
}
`,
      [
        32,
        n => `function rowReader${n}(value: Row${n}): number {
  return value.row${n};
}`,
      ],
      [
        32,
        n => `function columnReader${n}(value: Column${n}): number {
  return value.column${n};
}`,
      ],
      `
const readers: any[] = [
  rowReader0, rowReader1, rowReader2, rowReader3, rowReader4, rowReader5, rowReader6, rowReader7, rowReader8, rowReader9, rowReader10, rowReader11, rowReader12, rowReader13, rowReader14, rowReader15, rowReader16, rowReader17, rowReader18, rowReader19, rowReader20, rowReader21, rowReader22, rowReader23, rowReader24, rowReader25, rowReader26, rowReader27, rowReader28, rowReader29, rowReader30, rowReader31,
  columnReader0, columnReader1, columnReader2, columnReader3, columnReader4, columnReader5, columnReader6, columnReader7, columnReader8, columnReader9, columnReader10, columnReader11, columnReader12, columnReader13, columnReader14, columnReader15, columnReader16, columnReader17, columnReader18, columnReader19, columnReader20, columnReader21, columnReader22, columnReader23, columnReader24, columnReader25, columnReader26, columnReader27, columnReader28, columnReader29, columnReader30, columnReader31,
];
const names: string[] = [];
for (const kind of ["row", "column"]) for (let index = 0; index < 32; index++) names.push(kind + index);

const all = makeAll();
const holder: any = new Holder();

for (let round = 0; round < 3; round++) {
  for (let which = 0; which < names.length; which++) {
    let sumOfCalls = 0;
    let sumOfStores = 0;
    let numberThatFit = 0;
    for (const value of all) {
      const read = readers[which](value);
      if (read !== undefined) numberThatFit++;
      sumOfCalls += read | 0;
      holder[names[which]] = value;
      sumOfStores += holder[names[which]][names[which]] | 0;
    }
    console.log(names[which], numberThatFit, sumOfCalls, sumOfStores);
  }
}
const typed: Holder = holder;
console.log(typed.row31.row31 | 0, typed.column31.column31 | 0, typed.row0.row0 | 0, typed.column0.column0 | 0);
`,
    ),
    "four-literals-far-apart-fit-an-interface.ts": text(
      `// 1,152 object literals in 96 rows of 12, each with a name of its own, an interface for each row, which its 12 literals fit, and one for each column, which four literals fit, 24 rows apart. The shapes are numbered along the rows, so the four lie far apart: a handful of shapes over a span of some 900, which is a table with a slot for each and no set of bits. A field and a parameter of each of the 12 column types take every literal, through a store by a computed name, through a call from untyped code and through a test in typed code.`,
      [
        96,
        n => `interface Row${n} {
  row${n}: number;
}`,
      ],
      [
        12,
        n => `interface Column${n} {
  column${n}: number;
}`,
      ],
      `class Holder {`,
      [12, n => `  column${n}: Column${n} = { column${n}: -1 };`],
      `}
function makeAll(): unknown[] {
  const all: unknown[] = [];`,
      [
        2,
        n => `  all.push({ row${3 * n}: ${39 * n + 1}, column${3 * n}: ${39 * n + 2}, own${39 * n + 1}: ${39 * n + 3} });
  all.push({ row${3 * n}: ${39 * n + 2}, own${39 * n + 2}: ${39 * n + 4} });
  all.push({ row${3 * n}: ${39 * n + 3}, own${39 * n + 3}: ${39 * n + 5} });
  all.push({ row${3 * n}: ${39 * n + 4}, own${39 * n + 4}: ${39 * n + 6} });
  all.push({ row${3 * n}: ${39 * n + 5}, own${39 * n + 5}: ${39 * n + 7} });
  all.push({ row${3 * n}: ${39 * n + 6}, own${39 * n + 6}: ${39 * n + 8} });
  all.push({ row${3 * n}: ${39 * n + 7}, own${39 * n + 7}: ${39 * n + 9} });
  all.push({ row${3 * n}: ${39 * n + 8}, own${39 * n + 8}: ${39 * n + 10} });
  all.push({ row${3 * n}: ${39 * n + 9}, own${39 * n + 9}: ${39 * n + 11} });
  all.push({ row${4 * n}: ${39 * n + 10}, own${39 * n + 10}: ${39 * n + 12} });
  all.push({ row${4 * n}: ${39 * n + 11}, own${39 * n + 11}: ${39 * n + 13} });
  all.push({ row${4 * n}: ${39 * n + 12}, own${39 * n + 12}: ${39 * n + 14} });
  all.push({ row${3 * n + 1}: ${39 * n + 13}, own${39 * n + 13}: ${39 * n + 15} });
  all.push({ row${3 * n + 1}: ${39 * n + 14}, column${3 * n + 1}: ${39 * n + 15}, own${39 * n + 14}: ${39 * n + 16} });
  all.push({ row${3 * n + 1}: ${39 * n + 15}, own${39 * n + 15}: ${39 * n + 17} });
  all.push({ row${3 * n + 1}: ${39 * n + 16}, own${39 * n + 16}: ${39 * n + 18} });
  all.push({ row${3 * n + 1}: ${39 * n + 17}, own${39 * n + 17}: ${39 * n + 19} });
  all.push({ row${3 * n + 1}: ${39 * n + 18}, own${39 * n + 18}: ${39 * n + 20} });
  all.push({ row${3 * n + 1}: ${39 * n + 19}, own${39 * n + 19}: ${39 * n + 21} });
  all.push({ row${3 * n + 1}: ${39 * n + 20}, own${39 * n + 20}: ${39 * n + 22} });
  all.push({ row${3 * n + 1}: ${39 * n + 21}, own${39 * n + 21}: ${39 * n + 23} });
  all.push({ row${4 * n + 1}: ${39 * n + 22}, own${39 * n + 22}: ${39 * n + 24} });
  all.push({ row${4 * n + 1}: ${39 * n + 23}, own${39 * n + 23}: ${39 * n + 25} });
  all.push({ row${4 * n + 1}: ${39 * n + 24}, own${39 * n + 24}: ${39 * n + 26} });
  all.push({ row${3 * n + 2}: ${39 * n + 25}, own${39 * n + 25}: ${39 * n + 27} });
  all.push({ row${3 * n + 2}: ${39 * n + 26}, own${39 * n + 26}: ${39 * n + 28} });
  all.push({ row${3 * n + 2}: ${39 * n + 27}, column${3 * n + 2}: ${39 * n + 28}, own${39 * n + 27}: ${39 * n + 29} });
  all.push({ row${3 * n + 2}: ${39 * n + 28}, own${39 * n + 28}: ${39 * n + 30} });
  all.push({ row${3 * n + 2}: ${39 * n + 29}, own${39 * n + 29}: ${39 * n + 31} });
  all.push({ row${3 * n + 2}: ${39 * n + 30}, own${39 * n + 30}: ${39 * n + 32} });
  all.push({ row${3 * n + 2}: ${39 * n + 31}, own${39 * n + 31}: ${39 * n + 33} });
  all.push({ row${3 * n + 2}: ${39 * n + 32}, own${39 * n + 32}: ${39 * n + 34} });
  all.push({ row${3 * n + 2}: ${39 * n + 33}, own${39 * n + 33}: ${39 * n + 35} });
  all.push({ row${4 * n + 2}: ${39 * n + 34}, own${39 * n + 34}: ${39 * n + 36} });
  all.push({ row${4 * n + 2}: ${39 * n + 35}, own${39 * n + 35}: ${39 * n + 37} });
  all.push({ row${4 * n + 2}: ${39 * n + 36}, own${39 * n + 36}: ${39 * n + 38} });
  all.push({ row${3 * n + 3}: ${39 * n + 37}, own${39 * n + 37}: ${39 * n + 39} });
  all.push({ row${3 * n + 3}: ${39 * n + 38}, own${39 * n + 38}: ${39 * n + 40} });
  all.push({ row${3 * n + 3}: ${39 * n + 39}, own${39 * n + 39}: ${39 * n + 41} });`,
      ],
      [
        2,
        n => `  all.push({ row${3 * n + 6}: ${39 * n + 79}, column${3 * n + 6}: ${39 * n + 80}, own${39 * n + 79}: ${39 * n + 81} });
  all.push({ row${3 * n + 6}: ${39 * n + 80}, own${39 * n + 80}: ${39 * n + 82} });
  all.push({ row${3 * n + 6}: ${39 * n + 81}, own${39 * n + 81}: ${39 * n + 83} });
  all.push({ row${4 * n + 6}: ${39 * n + 82}, own${39 * n + 82}: ${39 * n + 84} });
  all.push({ row${4 * n + 6}: ${39 * n + 83}, own${39 * n + 83}: ${39 * n + 85} });
  all.push({ row${4 * n + 6}: ${39 * n + 84}, own${39 * n + 84}: ${39 * n + 86} });
  all.push({ row${3 * n + 7}: ${39 * n + 85}, own${39 * n + 85}: ${39 * n + 87} });
  all.push({ row${3 * n + 7}: ${39 * n + 86}, own${39 * n + 86}: ${39 * n + 88} });
  all.push({ row${3 * n + 7}: ${39 * n + 87}, own${39 * n + 87}: ${39 * n + 89} });
  all.push({ row${3 * n + 7}: ${39 * n + 88}, own${39 * n + 88}: ${39 * n + 90} });
  all.push({ row${3 * n + 7}: ${39 * n + 89}, own${39 * n + 89}: ${39 * n + 91} });
  all.push({ row${3 * n + 7}: ${39 * n + 90}, own${39 * n + 90}: ${39 * n + 92} });
  all.push({ row${3 * n + 7}: ${39 * n + 91}, own${39 * n + 91}: ${39 * n + 93} });
  all.push({ row${3 * n + 7}: ${39 * n + 92}, column${3 * n + 7}: ${39 * n + 93}, own${39 * n + 92}: ${39 * n + 94} });
  all.push({ row${3 * n + 7}: ${39 * n + 93}, own${39 * n + 93}: ${39 * n + 95} });
  all.push({ row${4 * n + 7}: ${39 * n + 94}, own${39 * n + 94}: ${39 * n + 96} });
  all.push({ row${4 * n + 7}: ${39 * n + 95}, own${39 * n + 95}: ${39 * n + 97} });
  all.push({ row${4 * n + 7}: ${39 * n + 96}, own${39 * n + 96}: ${39 * n + 98} });
  all.push({ row${3 * n + 8}: ${39 * n + 97}, own${39 * n + 97}: ${39 * n + 99} });
  all.push({ row${3 * n + 8}: ${39 * n + 98}, own${39 * n + 98}: ${39 * n + 100} });
  all.push({ row${3 * n + 8}: ${39 * n + 99}, own${39 * n + 99}: ${39 * n + 101} });
  all.push({ row${3 * n + 8}: ${39 * n + 100}, own${39 * n + 100}: ${39 * n + 102} });
  all.push({ row${3 * n + 8}: ${39 * n + 101}, own${39 * n + 101}: ${39 * n + 103} });
  all.push({ row${3 * n + 8}: ${39 * n + 102}, own${39 * n + 102}: ${39 * n + 104} });
  all.push({ row${3 * n + 8}: ${39 * n + 103}, own${39 * n + 103}: ${39 * n + 105} });
  all.push({ row${3 * n + 8}: ${39 * n + 104}, own${39 * n + 104}: ${39 * n + 106} });
  all.push({ row${3 * n + 8}: ${39 * n + 105}, column${3 * n + 8}: ${39 * n + 106}, own${39 * n + 105}: ${39 * n + 107} });
  all.push({ row${4 * n + 8}: ${39 * n + 106}, own${39 * n + 106}: ${39 * n + 108} });
  all.push({ row${4 * n + 8}: ${39 * n + 107}, own${39 * n + 107}: ${39 * n + 109} });
  all.push({ row${4 * n + 8}: ${39 * n + 108}, own${39 * n + 108}: ${39 * n + 110} });
  all.push({ row${3 * n + 9}: ${39 * n + 109}, own${39 * n + 109}: ${39 * n + 111} });
  all.push({ row${3 * n + 9}: ${39 * n + 110}, own${39 * n + 110}: ${39 * n + 112} });
  all.push({ row${3 * n + 9}: ${39 * n + 111}, own${39 * n + 111}: ${39 * n + 113} });
  all.push({ row${3 * n + 9}: ${39 * n + 112}, own${39 * n + 112}: ${39 * n + 114} });
  all.push({ row${3 * n + 9}: ${39 * n + 113}, own${39 * n + 113}: ${39 * n + 115} });
  all.push({ row${3 * n + 9}: ${39 * n + 114}, own${39 * n + 114}: ${39 * n + 116} });
  all.push({ row${3 * n + 9}: ${39 * n + 115}, own${39 * n + 115}: ${39 * n + 117} });
  all.push({ row${3 * n + 9}: ${39 * n + 116}, own${39 * n + 116}: ${39 * n + 118} });
  all.push({ row${3 * n + 9}: ${39 * n + 117}, own${39 * n + 117}: ${39 * n + 119} });`,
      ],
      [
        11,
        n => `  all.push({ row${n + 13}: ${12 * n + 157}, own${12 * n + 157}: ${12 * n + 159} });
  all.push({ row${n + 13}: ${12 * n + 158}, own${12 * n + 158}: ${12 * n + 160} });
  all.push({ row${n + 13}: ${12 * n + 159}, own${12 * n + 159}: ${12 * n + 161} });
  all.push({ row${n + 13}: ${12 * n + 160}, own${12 * n + 160}: ${12 * n + 162} });
  all.push({ row${n + 13}: ${12 * n + 161}, own${12 * n + 161}: ${12 * n + 163} });
  all.push({ row${n + 13}: ${12 * n + 162}, own${12 * n + 162}: ${12 * n + 164} });
  all.push({ row${n + 13}: ${12 * n + 163}, own${12 * n + 163}: ${12 * n + 165} });
  all.push({ row${n + 13}: ${12 * n + 164}, own${12 * n + 164}: ${12 * n + 166} });
  all.push({ row${n + 13}: ${12 * n + 165}, own${12 * n + 165}: ${12 * n + 167} });
  all.push({ row${n + 13}: ${12 * n + 166}, own${12 * n + 166}: ${12 * n + 168} });
  all.push({ row${n + 13}: ${12 * n + 167}, own${12 * n + 167}: ${12 * n + 169} });
  all.push({ row${n + 13}: ${12 * n + 168}, own${12 * n + 168}: ${12 * n + 170} });`,
      ],
      [
        2,
        n => `  all.push({ row${3 * n + 24}: ${39 * n + 289}, column${3 * n}: ${39 * n + 290}, own${39 * n + 289}: ${39 * n + 291} });
  all.push({ row${3 * n + 24}: ${39 * n + 290}, own${39 * n + 290}: ${39 * n + 292} });
  all.push({ row${3 * n + 24}: ${39 * n + 291}, own${39 * n + 291}: ${39 * n + 293} });
  all.push({ row${3 * n + 24}: ${39 * n + 292}, own${39 * n + 292}: ${39 * n + 294} });
  all.push({ row${3 * n + 24}: ${39 * n + 293}, own${39 * n + 293}: ${39 * n + 295} });
  all.push({ row${3 * n + 24}: ${39 * n + 294}, own${39 * n + 294}: ${39 * n + 296} });
  all.push({ row${3 * n + 24}: ${39 * n + 295}, own${39 * n + 295}: ${39 * n + 297} });
  all.push({ row${3 * n + 24}: ${39 * n + 296}, own${39 * n + 296}: ${39 * n + 298} });
  all.push({ row${3 * n + 24}: ${39 * n + 297}, own${39 * n + 297}: ${39 * n + 299} });
  all.push({ row${4 * n + 24}: ${39 * n + 298}, own${39 * n + 298}: ${39 * n + 300} });
  all.push({ row${4 * n + 24}: ${39 * n + 299}, own${39 * n + 299}: ${39 * n + 301} });
  all.push({ row${4 * n + 24}: ${39 * n + 300}, own${39 * n + 300}: ${39 * n + 302} });
  all.push({ row${3 * n + 25}: ${39 * n + 301}, own${39 * n + 301}: ${39 * n + 303} });
  all.push({ row${3 * n + 25}: ${39 * n + 302}, column${3 * n + 1}: ${39 * n + 303}, own${39 * n + 302}: ${39 * n + 304} });
  all.push({ row${3 * n + 25}: ${39 * n + 303}, own${39 * n + 303}: ${39 * n + 305} });
  all.push({ row${3 * n + 25}: ${39 * n + 304}, own${39 * n + 304}: ${39 * n + 306} });
  all.push({ row${3 * n + 25}: ${39 * n + 305}, own${39 * n + 305}: ${39 * n + 307} });
  all.push({ row${3 * n + 25}: ${39 * n + 306}, own${39 * n + 306}: ${39 * n + 308} });
  all.push({ row${3 * n + 25}: ${39 * n + 307}, own${39 * n + 307}: ${39 * n + 309} });
  all.push({ row${3 * n + 25}: ${39 * n + 308}, own${39 * n + 308}: ${39 * n + 310} });
  all.push({ row${3 * n + 25}: ${39 * n + 309}, own${39 * n + 309}: ${39 * n + 311} });
  all.push({ row${4 * n + 25}: ${39 * n + 310}, own${39 * n + 310}: ${39 * n + 312} });
  all.push({ row${4 * n + 25}: ${39 * n + 311}, own${39 * n + 311}: ${39 * n + 313} });
  all.push({ row${4 * n + 25}: ${39 * n + 312}, own${39 * n + 312}: ${39 * n + 314} });
  all.push({ row${3 * n + 26}: ${39 * n + 313}, own${39 * n + 313}: ${39 * n + 315} });
  all.push({ row${3 * n + 26}: ${39 * n + 314}, own${39 * n + 314}: ${39 * n + 316} });
  all.push({ row${3 * n + 26}: ${39 * n + 315}, column${3 * n + 2}: ${39 * n + 316}, own${39 * n + 315}: ${39 * n + 317} });
  all.push({ row${3 * n + 26}: ${39 * n + 316}, own${39 * n + 316}: ${39 * n + 318} });
  all.push({ row${3 * n + 26}: ${39 * n + 317}, own${39 * n + 317}: ${39 * n + 319} });
  all.push({ row${3 * n + 26}: ${39 * n + 318}, own${39 * n + 318}: ${39 * n + 320} });
  all.push({ row${3 * n + 26}: ${39 * n + 319}, own${39 * n + 319}: ${39 * n + 321} });
  all.push({ row${3 * n + 26}: ${39 * n + 320}, own${39 * n + 320}: ${39 * n + 322} });
  all.push({ row${3 * n + 26}: ${39 * n + 321}, own${39 * n + 321}: ${39 * n + 323} });
  all.push({ row${4 * n + 26}: ${39 * n + 322}, own${39 * n + 322}: ${39 * n + 324} });
  all.push({ row${4 * n + 26}: ${39 * n + 323}, own${39 * n + 323}: ${39 * n + 325} });
  all.push({ row${4 * n + 26}: ${39 * n + 324}, own${39 * n + 324}: ${39 * n + 326} });
  all.push({ row${3 * n + 27}: ${39 * n + 325}, own${39 * n + 325}: ${39 * n + 327} });
  all.push({ row${3 * n + 27}: ${39 * n + 326}, own${39 * n + 326}: ${39 * n + 328} });
  all.push({ row${3 * n + 27}: ${39 * n + 327}, own${39 * n + 327}: ${39 * n + 329} });`,
      ],
      [
        2,
        n => `  all.push({ row${3 * n + 30}: ${39 * n + 367}, column${3 * n + 6}: ${39 * n + 368}, own${39 * n + 367}: ${39 * n + 369} });
  all.push({ row${3 * n + 30}: ${39 * n + 368}, own${39 * n + 368}: ${39 * n + 370} });
  all.push({ row${3 * n + 30}: ${39 * n + 369}, own${39 * n + 369}: ${39 * n + 371} });
  all.push({ row${4 * n + 30}: ${39 * n + 370}, own${39 * n + 370}: ${39 * n + 372} });
  all.push({ row${4 * n + 30}: ${39 * n + 371}, own${39 * n + 371}: ${39 * n + 373} });
  all.push({ row${4 * n + 30}: ${39 * n + 372}, own${39 * n + 372}: ${39 * n + 374} });
  all.push({ row${3 * n + 31}: ${39 * n + 373}, own${39 * n + 373}: ${39 * n + 375} });
  all.push({ row${3 * n + 31}: ${39 * n + 374}, own${39 * n + 374}: ${39 * n + 376} });
  all.push({ row${3 * n + 31}: ${39 * n + 375}, own${39 * n + 375}: ${39 * n + 377} });
  all.push({ row${3 * n + 31}: ${39 * n + 376}, own${39 * n + 376}: ${39 * n + 378} });
  all.push({ row${3 * n + 31}: ${39 * n + 377}, own${39 * n + 377}: ${39 * n + 379} });
  all.push({ row${3 * n + 31}: ${39 * n + 378}, own${39 * n + 378}: ${39 * n + 380} });
  all.push({ row${3 * n + 31}: ${39 * n + 379}, own${39 * n + 379}: ${39 * n + 381} });
  all.push({ row${3 * n + 31}: ${39 * n + 380}, column${3 * n + 7}: ${39 * n + 381}, own${39 * n + 380}: ${39 * n + 382} });
  all.push({ row${3 * n + 31}: ${39 * n + 381}, own${39 * n + 381}: ${39 * n + 383} });
  all.push({ row${4 * n + 31}: ${39 * n + 382}, own${39 * n + 382}: ${39 * n + 384} });
  all.push({ row${4 * n + 31}: ${39 * n + 383}, own${39 * n + 383}: ${39 * n + 385} });
  all.push({ row${4 * n + 31}: ${39 * n + 384}, own${39 * n + 384}: ${39 * n + 386} });
  all.push({ row${3 * n + 32}: ${39 * n + 385}, own${39 * n + 385}: ${39 * n + 387} });
  all.push({ row${3 * n + 32}: ${39 * n + 386}, own${39 * n + 386}: ${39 * n + 388} });
  all.push({ row${3 * n + 32}: ${39 * n + 387}, own${39 * n + 387}: ${39 * n + 389} });
  all.push({ row${3 * n + 32}: ${39 * n + 388}, own${39 * n + 388}: ${39 * n + 390} });
  all.push({ row${3 * n + 32}: ${39 * n + 389}, own${39 * n + 389}: ${39 * n + 391} });
  all.push({ row${3 * n + 32}: ${39 * n + 390}, own${39 * n + 390}: ${39 * n + 392} });
  all.push({ row${3 * n + 32}: ${39 * n + 391}, own${39 * n + 391}: ${39 * n + 393} });
  all.push({ row${3 * n + 32}: ${39 * n + 392}, own${39 * n + 392}: ${39 * n + 394} });
  all.push({ row${3 * n + 32}: ${39 * n + 393}, column${3 * n + 8}: ${39 * n + 394}, own${39 * n + 393}: ${39 * n + 395} });
  all.push({ row${4 * n + 32}: ${39 * n + 394}, own${39 * n + 394}: ${39 * n + 396} });
  all.push({ row${4 * n + 32}: ${39 * n + 395}, own${39 * n + 395}: ${39 * n + 397} });
  all.push({ row${4 * n + 32}: ${39 * n + 396}, own${39 * n + 396}: ${39 * n + 398} });
  all.push({ row${3 * n + 33}: ${39 * n + 397}, own${39 * n + 397}: ${39 * n + 399} });
  all.push({ row${3 * n + 33}: ${39 * n + 398}, own${39 * n + 398}: ${39 * n + 400} });
  all.push({ row${3 * n + 33}: ${39 * n + 399}, own${39 * n + 399}: ${39 * n + 401} });
  all.push({ row${3 * n + 33}: ${39 * n + 400}, own${39 * n + 400}: ${39 * n + 402} });
  all.push({ row${3 * n + 33}: ${39 * n + 401}, own${39 * n + 401}: ${39 * n + 403} });
  all.push({ row${3 * n + 33}: ${39 * n + 402}, own${39 * n + 402}: ${39 * n + 404} });
  all.push({ row${3 * n + 33}: ${39 * n + 403}, own${39 * n + 403}: ${39 * n + 405} });
  all.push({ row${3 * n + 33}: ${39 * n + 404}, own${39 * n + 404}: ${39 * n + 406} });
  all.push({ row${3 * n + 33}: ${39 * n + 405}, own${39 * n + 405}: ${39 * n + 407} });`,
      ],
      [
        11,
        n => `  all.push({ row${n + 37}: ${12 * n + 445}, own${12 * n + 445}: ${12 * n + 447} });
  all.push({ row${n + 37}: ${12 * n + 446}, own${12 * n + 446}: ${12 * n + 448} });
  all.push({ row${n + 37}: ${12 * n + 447}, own${12 * n + 447}: ${12 * n + 449} });
  all.push({ row${n + 37}: ${12 * n + 448}, own${12 * n + 448}: ${12 * n + 450} });
  all.push({ row${n + 37}: ${12 * n + 449}, own${12 * n + 449}: ${12 * n + 451} });
  all.push({ row${n + 37}: ${12 * n + 450}, own${12 * n + 450}: ${12 * n + 452} });
  all.push({ row${n + 37}: ${12 * n + 451}, own${12 * n + 451}: ${12 * n + 453} });
  all.push({ row${n + 37}: ${12 * n + 452}, own${12 * n + 452}: ${12 * n + 454} });
  all.push({ row${n + 37}: ${12 * n + 453}, own${12 * n + 453}: ${12 * n + 455} });
  all.push({ row${n + 37}: ${12 * n + 454}, own${12 * n + 454}: ${12 * n + 456} });
  all.push({ row${n + 37}: ${12 * n + 455}, own${12 * n + 455}: ${12 * n + 457} });
  all.push({ row${n + 37}: ${12 * n + 456}, own${12 * n + 456}: ${12 * n + 458} });`,
      ],
      [
        2,
        n => `  all.push({ row${3 * n + 48}: ${39 * n + 577}, column${3 * n}: ${39 * n + 578}, own${39 * n + 577}: ${39 * n + 579} });
  all.push({ row${3 * n + 48}: ${39 * n + 578}, own${39 * n + 578}: ${39 * n + 580} });
  all.push({ row${3 * n + 48}: ${39 * n + 579}, own${39 * n + 579}: ${39 * n + 581} });
  all.push({ row${3 * n + 48}: ${39 * n + 580}, own${39 * n + 580}: ${39 * n + 582} });
  all.push({ row${3 * n + 48}: ${39 * n + 581}, own${39 * n + 581}: ${39 * n + 583} });
  all.push({ row${3 * n + 48}: ${39 * n + 582}, own${39 * n + 582}: ${39 * n + 584} });
  all.push({ row${3 * n + 48}: ${39 * n + 583}, own${39 * n + 583}: ${39 * n + 585} });
  all.push({ row${3 * n + 48}: ${39 * n + 584}, own${39 * n + 584}: ${39 * n + 586} });
  all.push({ row${3 * n + 48}: ${39 * n + 585}, own${39 * n + 585}: ${39 * n + 587} });
  all.push({ row${4 * n + 48}: ${39 * n + 586}, own${39 * n + 586}: ${39 * n + 588} });
  all.push({ row${4 * n + 48}: ${39 * n + 587}, own${39 * n + 587}: ${39 * n + 589} });
  all.push({ row${4 * n + 48}: ${39 * n + 588}, own${39 * n + 588}: ${39 * n + 590} });
  all.push({ row${3 * n + 49}: ${39 * n + 589}, own${39 * n + 589}: ${39 * n + 591} });
  all.push({ row${3 * n + 49}: ${39 * n + 590}, column${3 * n + 1}: ${39 * n + 591}, own${39 * n + 590}: ${39 * n + 592} });
  all.push({ row${3 * n + 49}: ${39 * n + 591}, own${39 * n + 591}: ${39 * n + 593} });
  all.push({ row${3 * n + 49}: ${39 * n + 592}, own${39 * n + 592}: ${39 * n + 594} });
  all.push({ row${3 * n + 49}: ${39 * n + 593}, own${39 * n + 593}: ${39 * n + 595} });
  all.push({ row${3 * n + 49}: ${39 * n + 594}, own${39 * n + 594}: ${39 * n + 596} });
  all.push({ row${3 * n + 49}: ${39 * n + 595}, own${39 * n + 595}: ${39 * n + 597} });
  all.push({ row${3 * n + 49}: ${39 * n + 596}, own${39 * n + 596}: ${39 * n + 598} });
  all.push({ row${3 * n + 49}: ${39 * n + 597}, own${39 * n + 597}: ${39 * n + 599} });
  all.push({ row${4 * n + 49}: ${39 * n + 598}, own${39 * n + 598}: ${39 * n + 600} });
  all.push({ row${4 * n + 49}: ${39 * n + 599}, own${39 * n + 599}: ${39 * n + 601} });
  all.push({ row${4 * n + 49}: ${39 * n + 600}, own${39 * n + 600}: ${39 * n + 602} });
  all.push({ row${3 * n + 50}: ${39 * n + 601}, own${39 * n + 601}: ${39 * n + 603} });
  all.push({ row${3 * n + 50}: ${39 * n + 602}, own${39 * n + 602}: ${39 * n + 604} });
  all.push({ row${3 * n + 50}: ${39 * n + 603}, column${3 * n + 2}: ${39 * n + 604}, own${39 * n + 603}: ${39 * n + 605} });
  all.push({ row${3 * n + 50}: ${39 * n + 604}, own${39 * n + 604}: ${39 * n + 606} });
  all.push({ row${3 * n + 50}: ${39 * n + 605}, own${39 * n + 605}: ${39 * n + 607} });
  all.push({ row${3 * n + 50}: ${39 * n + 606}, own${39 * n + 606}: ${39 * n + 608} });
  all.push({ row${3 * n + 50}: ${39 * n + 607}, own${39 * n + 607}: ${39 * n + 609} });
  all.push({ row${3 * n + 50}: ${39 * n + 608}, own${39 * n + 608}: ${39 * n + 610} });
  all.push({ row${3 * n + 50}: ${39 * n + 609}, own${39 * n + 609}: ${39 * n + 611} });
  all.push({ row${4 * n + 50}: ${39 * n + 610}, own${39 * n + 610}: ${39 * n + 612} });
  all.push({ row${4 * n + 50}: ${39 * n + 611}, own${39 * n + 611}: ${39 * n + 613} });
  all.push({ row${4 * n + 50}: ${39 * n + 612}, own${39 * n + 612}: ${39 * n + 614} });
  all.push({ row${3 * n + 51}: ${39 * n + 613}, own${39 * n + 613}: ${39 * n + 615} });
  all.push({ row${3 * n + 51}: ${39 * n + 614}, own${39 * n + 614}: ${39 * n + 616} });
  all.push({ row${3 * n + 51}: ${39 * n + 615}, own${39 * n + 615}: ${39 * n + 617} });`,
      ],
      [
        2,
        n => `  all.push({ row${3 * n + 54}: ${39 * n + 655}, column${3 * n + 6}: ${39 * n + 656}, own${39 * n + 655}: ${39 * n + 657} });
  all.push({ row${3 * n + 54}: ${39 * n + 656}, own${39 * n + 656}: ${39 * n + 658} });
  all.push({ row${3 * n + 54}: ${39 * n + 657}, own${39 * n + 657}: ${39 * n + 659} });
  all.push({ row${4 * n + 54}: ${39 * n + 658}, own${39 * n + 658}: ${39 * n + 660} });
  all.push({ row${4 * n + 54}: ${39 * n + 659}, own${39 * n + 659}: ${39 * n + 661} });
  all.push({ row${4 * n + 54}: ${39 * n + 660}, own${39 * n + 660}: ${39 * n + 662} });
  all.push({ row${3 * n + 55}: ${39 * n + 661}, own${39 * n + 661}: ${39 * n + 663} });
  all.push({ row${3 * n + 55}: ${39 * n + 662}, own${39 * n + 662}: ${39 * n + 664} });
  all.push({ row${3 * n + 55}: ${39 * n + 663}, own${39 * n + 663}: ${39 * n + 665} });
  all.push({ row${3 * n + 55}: ${39 * n + 664}, own${39 * n + 664}: ${39 * n + 666} });
  all.push({ row${3 * n + 55}: ${39 * n + 665}, own${39 * n + 665}: ${39 * n + 667} });
  all.push({ row${3 * n + 55}: ${39 * n + 666}, own${39 * n + 666}: ${39 * n + 668} });
  all.push({ row${3 * n + 55}: ${39 * n + 667}, own${39 * n + 667}: ${39 * n + 669} });
  all.push({ row${3 * n + 55}: ${39 * n + 668}, column${3 * n + 7}: ${39 * n + 669}, own${39 * n + 668}: ${39 * n + 670} });
  all.push({ row${3 * n + 55}: ${39 * n + 669}, own${39 * n + 669}: ${39 * n + 671} });
  all.push({ row${4 * n + 55}: ${39 * n + 670}, own${39 * n + 670}: ${39 * n + 672} });
  all.push({ row${4 * n + 55}: ${39 * n + 671}, own${39 * n + 671}: ${39 * n + 673} });
  all.push({ row${4 * n + 55}: ${39 * n + 672}, own${39 * n + 672}: ${39 * n + 674} });
  all.push({ row${3 * n + 56}: ${39 * n + 673}, own${39 * n + 673}: ${39 * n + 675} });
  all.push({ row${3 * n + 56}: ${39 * n + 674}, own${39 * n + 674}: ${39 * n + 676} });
  all.push({ row${3 * n + 56}: ${39 * n + 675}, own${39 * n + 675}: ${39 * n + 677} });
  all.push({ row${3 * n + 56}: ${39 * n + 676}, own${39 * n + 676}: ${39 * n + 678} });
  all.push({ row${3 * n + 56}: ${39 * n + 677}, own${39 * n + 677}: ${39 * n + 679} });
  all.push({ row${3 * n + 56}: ${39 * n + 678}, own${39 * n + 678}: ${39 * n + 680} });
  all.push({ row${3 * n + 56}: ${39 * n + 679}, own${39 * n + 679}: ${39 * n + 681} });
  all.push({ row${3 * n + 56}: ${39 * n + 680}, own${39 * n + 680}: ${39 * n + 682} });
  all.push({ row${3 * n + 56}: ${39 * n + 681}, column${3 * n + 8}: ${39 * n + 682}, own${39 * n + 681}: ${39 * n + 683} });
  all.push({ row${4 * n + 56}: ${39 * n + 682}, own${39 * n + 682}: ${39 * n + 684} });
  all.push({ row${4 * n + 56}: ${39 * n + 683}, own${39 * n + 683}: ${39 * n + 685} });
  all.push({ row${4 * n + 56}: ${39 * n + 684}, own${39 * n + 684}: ${39 * n + 686} });
  all.push({ row${3 * n + 57}: ${39 * n + 685}, own${39 * n + 685}: ${39 * n + 687} });
  all.push({ row${3 * n + 57}: ${39 * n + 686}, own${39 * n + 686}: ${39 * n + 688} });
  all.push({ row${3 * n + 57}: ${39 * n + 687}, own${39 * n + 687}: ${39 * n + 689} });
  all.push({ row${3 * n + 57}: ${39 * n + 688}, own${39 * n + 688}: ${39 * n + 690} });
  all.push({ row${3 * n + 57}: ${39 * n + 689}, own${39 * n + 689}: ${39 * n + 691} });
  all.push({ row${3 * n + 57}: ${39 * n + 690}, own${39 * n + 690}: ${39 * n + 692} });
  all.push({ row${3 * n + 57}: ${39 * n + 691}, own${39 * n + 691}: ${39 * n + 693} });
  all.push({ row${3 * n + 57}: ${39 * n + 692}, own${39 * n + 692}: ${39 * n + 694} });
  all.push({ row${3 * n + 57}: ${39 * n + 693}, own${39 * n + 693}: ${39 * n + 695} });`,
      ],
      [
        11,
        n => `  all.push({ row${n + 61}: ${12 * n + 733}, own${12 * n + 733}: ${12 * n + 735} });
  all.push({ row${n + 61}: ${12 * n + 734}, own${12 * n + 734}: ${12 * n + 736} });
  all.push({ row${n + 61}: ${12 * n + 735}, own${12 * n + 735}: ${12 * n + 737} });
  all.push({ row${n + 61}: ${12 * n + 736}, own${12 * n + 736}: ${12 * n + 738} });
  all.push({ row${n + 61}: ${12 * n + 737}, own${12 * n + 737}: ${12 * n + 739} });
  all.push({ row${n + 61}: ${12 * n + 738}, own${12 * n + 738}: ${12 * n + 740} });
  all.push({ row${n + 61}: ${12 * n + 739}, own${12 * n + 739}: ${12 * n + 741} });
  all.push({ row${n + 61}: ${12 * n + 740}, own${12 * n + 740}: ${12 * n + 742} });
  all.push({ row${n + 61}: ${12 * n + 741}, own${12 * n + 741}: ${12 * n + 743} });
  all.push({ row${n + 61}: ${12 * n + 742}, own${12 * n + 742}: ${12 * n + 744} });
  all.push({ row${n + 61}: ${12 * n + 743}, own${12 * n + 743}: ${12 * n + 745} });
  all.push({ row${n + 61}: ${12 * n + 744}, own${12 * n + 744}: ${12 * n + 746} });`,
      ],
      [
        2,
        n => `  all.push({ row${3 * n + 72}: ${39 * n + 865}, column${3 * n}: ${39 * n + 866}, own${39 * n + 865}: ${39 * n + 867} });
  all.push({ row${3 * n + 72}: ${39 * n + 866}, own${39 * n + 866}: ${39 * n + 868} });
  all.push({ row${3 * n + 72}: ${39 * n + 867}, own${39 * n + 867}: ${39 * n + 869} });
  all.push({ row${3 * n + 72}: ${39 * n + 868}, own${39 * n + 868}: ${39 * n + 870} });
  all.push({ row${3 * n + 72}: ${39 * n + 869}, own${39 * n + 869}: ${39 * n + 871} });
  all.push({ row${3 * n + 72}: ${39 * n + 870}, own${39 * n + 870}: ${39 * n + 872} });
  all.push({ row${3 * n + 72}: ${39 * n + 871}, own${39 * n + 871}: ${39 * n + 873} });
  all.push({ row${3 * n + 72}: ${39 * n + 872}, own${39 * n + 872}: ${39 * n + 874} });
  all.push({ row${3 * n + 72}: ${39 * n + 873}, own${39 * n + 873}: ${39 * n + 875} });
  all.push({ row${4 * n + 72}: ${39 * n + 874}, own${39 * n + 874}: ${39 * n + 876} });
  all.push({ row${4 * n + 72}: ${39 * n + 875}, own${39 * n + 875}: ${39 * n + 877} });
  all.push({ row${4 * n + 72}: ${39 * n + 876}, own${39 * n + 876}: ${39 * n + 878} });
  all.push({ row${3 * n + 73}: ${39 * n + 877}, own${39 * n + 877}: ${39 * n + 879} });
  all.push({ row${3 * n + 73}: ${39 * n + 878}, column${3 * n + 1}: ${39 * n + 879}, own${39 * n + 878}: ${39 * n + 880} });
  all.push({ row${3 * n + 73}: ${39 * n + 879}, own${39 * n + 879}: ${39 * n + 881} });
  all.push({ row${3 * n + 73}: ${39 * n + 880}, own${39 * n + 880}: ${39 * n + 882} });
  all.push({ row${3 * n + 73}: ${39 * n + 881}, own${39 * n + 881}: ${39 * n + 883} });
  all.push({ row${3 * n + 73}: ${39 * n + 882}, own${39 * n + 882}: ${39 * n + 884} });
  all.push({ row${3 * n + 73}: ${39 * n + 883}, own${39 * n + 883}: ${39 * n + 885} });
  all.push({ row${3 * n + 73}: ${39 * n + 884}, own${39 * n + 884}: ${39 * n + 886} });
  all.push({ row${3 * n + 73}: ${39 * n + 885}, own${39 * n + 885}: ${39 * n + 887} });
  all.push({ row${4 * n + 73}: ${39 * n + 886}, own${39 * n + 886}: ${39 * n + 888} });
  all.push({ row${4 * n + 73}: ${39 * n + 887}, own${39 * n + 887}: ${39 * n + 889} });
  all.push({ row${4 * n + 73}: ${39 * n + 888}, own${39 * n + 888}: ${39 * n + 890} });
  all.push({ row${3 * n + 74}: ${39 * n + 889}, own${39 * n + 889}: ${39 * n + 891} });
  all.push({ row${3 * n + 74}: ${39 * n + 890}, own${39 * n + 890}: ${39 * n + 892} });
  all.push({ row${3 * n + 74}: ${39 * n + 891}, column${3 * n + 2}: ${39 * n + 892}, own${39 * n + 891}: ${39 * n + 893} });
  all.push({ row${3 * n + 74}: ${39 * n + 892}, own${39 * n + 892}: ${39 * n + 894} });
  all.push({ row${3 * n + 74}: ${39 * n + 893}, own${39 * n + 893}: ${39 * n + 895} });
  all.push({ row${3 * n + 74}: ${39 * n + 894}, own${39 * n + 894}: ${39 * n + 896} });
  all.push({ row${3 * n + 74}: ${39 * n + 895}, own${39 * n + 895}: ${39 * n + 897} });
  all.push({ row${3 * n + 74}: ${39 * n + 896}, own${39 * n + 896}: ${39 * n + 898} });
  all.push({ row${3 * n + 74}: ${39 * n + 897}, own${39 * n + 897}: ${39 * n + 899} });
  all.push({ row${4 * n + 74}: ${39 * n + 898}, own${39 * n + 898}: ${39 * n + 900} });
  all.push({ row${4 * n + 74}: ${39 * n + 899}, own${39 * n + 899}: ${39 * n + 901} });
  all.push({ row${4 * n + 74}: ${39 * n + 900}, own${39 * n + 900}: ${39 * n + 902} });
  all.push({ row${3 * n + 75}: ${39 * n + 901}, own${39 * n + 901}: ${39 * n + 903} });
  all.push({ row${3 * n + 75}: ${39 * n + 902}, own${39 * n + 902}: ${39 * n + 904} });
  all.push({ row${3 * n + 75}: ${39 * n + 903}, own${39 * n + 903}: ${39 * n + 905} });`,
      ],
      [
        2,
        n => `  all.push({ row${3 * n + 78}: ${39 * n + 943}, column${3 * n + 6}: ${39 * n + 944}, own${39 * n + 943}: ${39 * n + 945} });
  all.push({ row${3 * n + 78}: ${39 * n + 944}, own${39 * n + 944}: ${39 * n + 946} });
  all.push({ row${3 * n + 78}: ${39 * n + 945}, own${39 * n + 945}: ${39 * n + 947} });
  all.push({ row${4 * n + 78}: ${39 * n + 946}, own${39 * n + 946}: ${39 * n + 948} });
  all.push({ row${4 * n + 78}: ${39 * n + 947}, own${39 * n + 947}: ${39 * n + 949} });
  all.push({ row${4 * n + 78}: ${39 * n + 948}, own${39 * n + 948}: ${39 * n + 950} });
  all.push({ row${3 * n + 79}: ${39 * n + 949}, own${39 * n + 949}: ${39 * n + 951} });
  all.push({ row${3 * n + 79}: ${39 * n + 950}, own${39 * n + 950}: ${39 * n + 952} });
  all.push({ row${3 * n + 79}: ${39 * n + 951}, own${39 * n + 951}: ${39 * n + 953} });
  all.push({ row${3 * n + 79}: ${39 * n + 952}, own${39 * n + 952}: ${39 * n + 954} });
  all.push({ row${3 * n + 79}: ${39 * n + 953}, own${39 * n + 953}: ${39 * n + 955} });
  all.push({ row${3 * n + 79}: ${39 * n + 954}, own${39 * n + 954}: ${39 * n + 956} });
  all.push({ row${3 * n + 79}: ${39 * n + 955}, own${39 * n + 955}: ${39 * n + 957} });
  all.push({ row${3 * n + 79}: ${39 * n + 956}, column${3 * n + 7}: ${39 * n + 957}, own${39 * n + 956}: ${39 * n + 958} });
  all.push({ row${3 * n + 79}: ${39 * n + 957}, own${39 * n + 957}: ${39 * n + 959} });
  all.push({ row${4 * n + 79}: ${39 * n + 958}, own${39 * n + 958}: ${39 * n + 960} });
  all.push({ row${4 * n + 79}: ${39 * n + 959}, own${39 * n + 959}: ${39 * n + 961} });
  all.push({ row${4 * n + 79}: ${39 * n + 960}, own${39 * n + 960}: ${39 * n + 962} });
  all.push({ row${3 * n + 80}: ${39 * n + 961}, own${39 * n + 961}: ${39 * n + 963} });
  all.push({ row${3 * n + 80}: ${39 * n + 962}, own${39 * n + 962}: ${39 * n + 964} });
  all.push({ row${3 * n + 80}: ${39 * n + 963}, own${39 * n + 963}: ${39 * n + 965} });
  all.push({ row${3 * n + 80}: ${39 * n + 964}, own${39 * n + 964}: ${39 * n + 966} });
  all.push({ row${3 * n + 80}: ${39 * n + 965}, own${39 * n + 965}: ${39 * n + 967} });
  all.push({ row${3 * n + 80}: ${39 * n + 966}, own${39 * n + 966}: ${39 * n + 968} });
  all.push({ row${3 * n + 80}: ${39 * n + 967}, own${39 * n + 967}: ${39 * n + 969} });
  all.push({ row${3 * n + 80}: ${39 * n + 968}, own${39 * n + 968}: ${39 * n + 970} });
  all.push({ row${3 * n + 80}: ${39 * n + 969}, column${3 * n + 8}: ${39 * n + 970}, own${39 * n + 969}: ${39 * n + 971} });
  all.push({ row${4 * n + 80}: ${39 * n + 970}, own${39 * n + 970}: ${39 * n + 972} });
  all.push({ row${4 * n + 80}: ${39 * n + 971}, own${39 * n + 971}: ${39 * n + 973} });
  all.push({ row${4 * n + 80}: ${39 * n + 972}, own${39 * n + 972}: ${39 * n + 974} });
  all.push({ row${3 * n + 81}: ${39 * n + 973}, own${39 * n + 973}: ${39 * n + 975} });
  all.push({ row${3 * n + 81}: ${39 * n + 974}, own${39 * n + 974}: ${39 * n + 976} });
  all.push({ row${3 * n + 81}: ${39 * n + 975}, own${39 * n + 975}: ${39 * n + 977} });
  all.push({ row${3 * n + 81}: ${39 * n + 976}, own${39 * n + 976}: ${39 * n + 978} });
  all.push({ row${3 * n + 81}: ${39 * n + 977}, own${39 * n + 977}: ${39 * n + 979} });
  all.push({ row${3 * n + 81}: ${39 * n + 978}, own${39 * n + 978}: ${39 * n + 980} });
  all.push({ row${3 * n + 81}: ${39 * n + 979}, own${39 * n + 979}: ${39 * n + 981} });
  all.push({ row${3 * n + 81}: ${39 * n + 980}, own${39 * n + 980}: ${39 * n + 982} });
  all.push({ row${3 * n + 81}: ${39 * n + 981}, own${39 * n + 981}: ${39 * n + 983} });`,
      ],
      [
        11,
        n => `  all.push({ row${n + 85}: ${12 * n + 1021}, own${12 * n + 1021}: ${12 * n + 1023} });
  all.push({ row${n + 85}: ${12 * n + 1022}, own${12 * n + 1022}: ${12 * n + 1024} });
  all.push({ row${n + 85}: ${12 * n + 1023}, own${12 * n + 1023}: ${12 * n + 1025} });
  all.push({ row${n + 85}: ${12 * n + 1024}, own${12 * n + 1024}: ${12 * n + 1026} });
  all.push({ row${n + 85}: ${12 * n + 1025}, own${12 * n + 1025}: ${12 * n + 1027} });
  all.push({ row${n + 85}: ${12 * n + 1026}, own${12 * n + 1026}: ${12 * n + 1028} });
  all.push({ row${n + 85}: ${12 * n + 1027}, own${12 * n + 1027}: ${12 * n + 1029} });
  all.push({ row${n + 85}: ${12 * n + 1028}, own${12 * n + 1028}: ${12 * n + 1030} });
  all.push({ row${n + 85}: ${12 * n + 1029}, own${12 * n + 1029}: ${12 * n + 1031} });
  all.push({ row${n + 85}: ${12 * n + 1030}, own${12 * n + 1030}: ${12 * n + 1032} });
  all.push({ row${n + 85}: ${12 * n + 1031}, own${12 * n + 1031}: ${12 * n + 1033} });
  all.push({ row${n + 85}: ${12 * n + 1032}, own${12 * n + 1032}: ${12 * n + 1034} });`,
      ],
      `  return all;`,
      [
        96,
        n => `}
function rowReader${n}(value: Row${n}): number {
  return value.row${n};`,
      ],
      [
        12,
        n => `}
function columnReader${n}(value: Column${n}): number {
  return value.column${n};`,
      ],
      [
        12,
        n => `}
function isColumn${n}(value: Row${n} | Row${n + 24} | Row${n + 48} | Row${n + 72} | Row${n + 13} | Column${n}): number {
  return "column${n}" in value ? value.column${n} : -2;`,
      ],
      `}
const rowReaders: any[] = [rowReader0, rowReader1, rowReader2, rowReader3, rowReader4, rowReader5, rowReader6, rowReader7, rowReader8, rowReader9, rowReader10, rowReader11, rowReader12, rowReader13, rowReader14, rowReader15, rowReader16, rowReader17, rowReader18, rowReader19, rowReader20, rowReader21, rowReader22, rowReader23, rowReader24, rowReader25, rowReader26, rowReader27, rowReader28, rowReader29, rowReader30, rowReader31, rowReader32, rowReader33, rowReader34, rowReader35, rowReader36, rowReader37, rowReader38, rowReader39, rowReader40, rowReader41, rowReader42, rowReader43, rowReader44, rowReader45, rowReader46, rowReader47, rowReader48, rowReader49, rowReader50, rowReader51, rowReader52, rowReader53, rowReader54, rowReader55, rowReader56, rowReader57, rowReader58, rowReader59, rowReader60, rowReader61, rowReader62, rowReader63, rowReader64, rowReader65, rowReader66, rowReader67, rowReader68, rowReader69, rowReader70, rowReader71, rowReader72, rowReader73, rowReader74, rowReader75, rowReader76, rowReader77, rowReader78, rowReader79, rowReader80, rowReader81, rowReader82, rowReader83, rowReader84, rowReader85, rowReader86, rowReader87, rowReader88, rowReader89, rowReader90, rowReader91, rowReader92, rowReader93, rowReader94, rowReader95];
const columnReaders: any[] = [columnReader0, columnReader1, columnReader2, columnReader3, columnReader4, columnReader5, columnReader6, columnReader7, columnReader8, columnReader9, columnReader10, columnReader11];
const columnTests: any[] = [isColumn0, isColumn1, isColumn2, isColumn3, isColumn4, isColumn5, isColumn6, isColumn7, isColumn8, isColumn9, isColumn10, isColumn11];

const all = makeAll();
const holder: any = new Holder();
for (let round = 0; round < 3; round++) {
  let sumOfRows = 0;
  for (let which = 0; which < rowReaders.length; which++) for (const value of all) sumOfRows += rowReaders[which](value) | 0;
  console.log("rows", sumOfRows);
  for (let which = 0; which < columnReaders.length; which++) {
    const name = "column" + which;
    let numberThatFit = 0;
    let sumOfCalls = 0;
    let sumOfStores = 0;
    let sumOfTests = 0;
    for (const value of all) {
      const read = columnReaders[which](value);
      if (read !== undefined) numberThatFit++;
      sumOfCalls += read | 0;
      holder[name] = value;
      sumOfStores += holder[name][name] | 0;
      sumOfTests += columnTests[which](value);
    }
    console.log(name, numberThatFit, sumOfCalls, sumOfStores, sumOfTests);
  }
}
const typed: Holder = holder;
console.log(typed.column0.column0 | 0, typed.column11.column11 | 0);
`,
    ),
    "members-of-an-interface-are-declared-far-apart.ts": text(
      `class P1 { p1: number = 1; }
class P2 extends P1 { p2: number = 2; }
class P3 extends P2 { p3: number = 3; }
class P4 extends P3 { p4: number = 4; }
class P5 extends P4 { p5: number = 5; }
class P6 extends P5 { p6: number = 6; }
class P7 extends P6 { p7: number = 7; }
class P8 extends P7 { p8: number = 8; }
interface HasValue { value: number; label: string; late?: number }
class M0 extends P1 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n} extends P1 {}`],
      `class M1 extends P2 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 80} extends P1 {}`],
      `class M2 extends P3 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 160} extends P1 {}`],
      `class M3 extends P4 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 240} extends P1 {}`],
      `class M4 extends P5 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 320} extends P1 {}`],
      `class M5 extends P6 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 400} extends P1 {}`],
      `class M6 extends P7 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 480} extends P1 {}`],
      `class M7 extends P8 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 560} extends P1 {}`],
      `class M8 extends P1 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 640} extends P1 {}`],
      `class M9 extends P2 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 720} extends P1 {}`],
      `class M10 extends P3 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 800} extends P1 {}`],
      `class M11 extends P4 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 880} extends P1 {}`],
      `class M12 extends P5 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 960} extends P1 {}`],
      `class M13 extends P6 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 1040} extends P1 {}`],
      `class M14 extends P7 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 1120} extends P1 {}`],
      `class M15 extends P8 implements HasValue { value: number; label: string; late?: number; constructor(v: number) { super(); this.value = v; this.label = "m" + v; } }`,
      [80, n => `class F${n + 1200} extends P1 {}`],
      `const others: P1[] = [];`,
      [
        128,
        n =>
          `others.push(new F${10 * n}(), new F${10 * n + 1}(), new F${10 * n + 2}(), new F${10 * n + 3}(), new F${10 * n + 4}(), new F${10 * n + 5}(), new F${10 * n + 6}(), new F${10 * n + 7}(), new F${10 * n + 8}(), new F${10 * n + 9}());`,
      ],
      `const items: HasValue[] = [new M0(0), new M1(1), new M2(2), new M3(3), new M4(4), new M5(5), new M6(6), new M7(7), new M8(8), new M9(9), new M10(10), new M11(11), new M12(12), new M13(13), new M14(14), new M15(15)];
function sumValues(list: HasValue[], n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + list[i & 15].value) | 0;
  return s;
}
function joinLabels(list: HasValue[], n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += list[i & 15].label;
  return s;
}
function bump(list: HasValue[], n: number): void {
  for (let i = 0; i < n; i++) list[i & 15].value = (list[i & 15].value + i) | 0;
}
function relabel(list: HasValue[], n: number): void {
  for (let i = 0; i < n; i++) list[i & 15].label = "r" + i;
}
function countLate(list: HasValue[], n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const late = list[i & 15].late;
    if (late !== undefined) s = (s + late + 1) | 0;
  }
  return s;
}
function addLate(list: HasValue[], n: number): void {
  for (let i = 0; i < n; i += 3) list[i & 15].late = i;
}
function sumInherited(p: P8): number {
  return p.p1 + p.p2 + p.p3 + p.p4 + p.p5 + p.p6 + p.p7 + p.p8;
}
function describe(list: HasValue[], n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += list[i & 15].value + ":" + list[i & 15].label + ":" + list[i & 15].late + " ";
  return s;
}
console.log(others.length, sumValues(items, 16), sumValues(items, 1000), joinLabels(items, 16), countLate(items, 16));
bump(items, 37);
relabel(items, 21);
console.log(sumValues(items, 16), joinLabels(items, 16), countLate(items, 16));
addLate(items, 20);
console.log(sumValues(items, 16), joinLabels(items, 16), countLate(items, 16));
addLate(items, 48);
bump(items, 16);
console.log(sumValues(items, 16), joinLabels(items, 16), countLate(items, 16));
console.log(sumInherited(new M7(1)), sumInherited(new M15(2)), describe(items, 16));
`,
    ),
  });
