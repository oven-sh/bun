// A closure reads a variable before it is assigned.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Person {
  first: string = "ann";
}

function numbers(): string {
  let n: number;
  const read = () => n;
  const plusOne = () => n + 1;
  const whole = () => n | 0;
  const kind = () => typeof n;
  const before = kind() + " " + read() + " " + plusOne() + " " + whole();
  n = 4;
  return before + " | " + kind() + " " + read() + " " + plusOne() + " " + whole();
}

function strings(): string {
  let s: string;
  const read = () => s;
  const joined = () => s + "!";
  const size = () => s.length;
  let before = typeof read() + " " + joined();
  try {
    before += " " + size();
  } catch (error) {
    before += " threw";
  }
  s = "set";
  return before + " | " + typeof read() + " " + joined() + " " + size();
}

function objects(): string {
  let p: Person;
  const read = () => p;
  const name = () => p.first;
  let before = typeof read();
  try {
    before += " " + name();
  } catch (error) {
    before += " threw";
  }
  p = new Person();
  return before + " | " + typeof read() + " " + name();
}

function functions(): string {
  let f: () => number;
  const call = () => f();
  let before: string;
  try {
    before = String(call());
  } catch (error) {
    before = "threw";
  }
  f = () => 3;
  return before + " | " + call();
}

function arrays(): string {
  let list: number[];
  const size = () => list.length;
  const kind = () => typeof list;
  let before = kind();
  try {
    before += " " + size();
  } catch (error) {
    before += " threw";
  }
  list = [1, 2];
  return before + " | " + kind() + " " + size();
}

function counters(): string {
  let count: number;
  const bump = () => {
    count++;
    return count;
  };
  const first = bump();
  count = 10;
  return first + " | " + bump();
}

function loops(): string {
  let total: number;
  const add = (n: number) => {
    total += n;
  };
  for (let i = 0; i < 3; i++) add(i);
  const peek = () => total;
  const early = peek();
  total = 0;
  for (let i = 0; i < 2000; i++) add(1);
  return early + " | " + total;
}

function hoisted(): string {
  const before = typeof peek() + " " + peek();
  var v: number = 5;
  function peek(): number {
    return v;
  }
  return before + " | " + typeof peek() + " " + peek();
}

show("numbers", numbers);
show("strings", strings);
show("objects", objects);
show("functions", functions);
show("arrays", arrays);
show("counters", counters);
show("loops", loops);
show("hoisted var", hoisted);

let shared: number;
function readShared(): number {
  return shared;
}
function sharedPlusOne(): number {
  return shared + 1;
}
show("a variable of the module", readShared);
show("plus one", sharedPlusOne);
shared = 1;
show("assigned", readShared);
show("plus one", sharedPlusOne);
