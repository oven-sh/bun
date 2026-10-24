// The prototypes of these nine classes have the same members in the same order, so whatever a store site remembers about the first may fit the others.
// One site in compiled code, one in an evaluated function with a fixed name and one in an evaluated function with a key each add the name to three prototypes in a row.
// In this twin no text is a constant: it is put together at run time, so the build cannot read it and it runs interpreted.
function atRunTime(text: string): string {
  return JSON.parse(JSON.stringify(text.split(""))).join("");
}
interface Probe {
  id: number;
  read(): number | undefined;
  write(value: number): void;
}
class A1 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class A2 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class A3 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class B1 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class B2 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class B3 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class C1 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class C2 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
class C3 implements Probe {
  declare x?: number;
  constructor(public id: number) {}
  read() { return this.x; }
  write(value: number) { this.x = value; }
}
type ProbeClass = new (id: number) => Probe;
function compiledSite(holder: any, value: number) {
  holder.x = value;
}
const evaluatedSite = new Function("holder", "value", atRunTime("holder.x = value")) as (holder: object, value: number) => void;
const evaluatedKeyedSite = new Function("holder", "key", "value", atRunTime("holder[key] = value")) as (holder: object, key: string, value: number) => void;
const groups: [string, ProbeClass[], (holder: object, value: number) => void][] = [
  ["a compiled site", [A1, A2, A3], compiledSite],
  ["an evaluated site", [B1, B2, B3], evaluatedSite],
  ["an evaluated site with a key", [C1, C2, C3], (holder, value) => evaluatedKeyedSite(holder, "x", value)],
];
function state(probe: Probe) {
  return `${probe.read()} ${"x" in probe} [${Object.keys(probe)}]`;
}
for (const [label, classes, put] of groups) {
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    const probe = new classes[i % 3](i);
    sum += probe.read() ?? 1;
    if (i & 1) probe.write(2);
    sum += probe.read() ?? 1;
  }
  for (let i = 0; i < 200; i++) put({ constructor: 1, read: 2, write: 3 }, i);
  const old = classes.map(C => new C(1));
  const steps: string[] = [];
  classes.forEach((C, index) => {
    put(C.prototype, (index + 1) * 10);
    steps.push(old.map(state).join(" ") + " / " + classes.map(K => state(new K(2))).join(" "));
  });
  console.log(label, sum);
  for (const step of steps) console.log("  " + step);
  for (const C of classes) delete (C.prototype as any).x;
  console.log("  gone again: " + old.map(state).join(" "));
  classes.forEach((C, index) => put(C.prototype, (index + 1) * 100));
  console.log("  a second time: " + old.map(state).join(" "));
}
