// Reads and stores of one field of one layout share what they learn. A read meets an object first, then the store meets the same object, for which reading the slot is fine and writing it is not.
class Gauge {
  unit = "unit";
  level = 1;
}

const trail: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function levelOf(gauge: Gauge): unknown {
  return gauge.level;
}
function setLevel(gauge: Gauge, level: number): void {
  gauge.level = level;
}
function readThenStore(mark: string, gauge: Gauge): void {
  const before = [levelOf(gauge), levelOf(gauge), levelOf(gauge)].map(String).join();
  const stored = attempt(() => setLevel(gauge, 50));
  console.log(mark + ":", before, stored, String(levelOf(gauge)), JSON.stringify(gauge), trail.splice(0).join(";"));
}
function storeThenRead(mark: string, gauge: Gauge): void {
  const stored = [attempt(() => setLevel(gauge, 60)), attempt(() => setLevel(gauge, 61))].join();
  console.log(mark + ":", stored, String(levelOf(gauge)), JSON.stringify(gauge), trail.splice(0).join(";"));
}

function lookAlike(): Gauge {
  return JSON.parse('{"spare":0,"level":2,"unit":"parsed"}');
}

readThenStore("honest", new Gauge());
readThenStore("look-alike", lookAlike());
readThenStore("read-only look-alike", Object.defineProperty(lookAlike(), "level", { writable: false }));
readThenStore("look-alike", lookAlike());
readThenStore("frozen look-alike", Object.freeze(lookAlike()));
readThenStore("read-only honest", Object.defineProperty(new Gauge(), "level", { writable: false }));
readThenStore("honest", new Gauge());

const inherited: Gauge = Object.create(lookAlike());
readThenStore("the field is inherited, the store creates one", inherited);
readThenStore("and now it has its own", inherited);

const inheritedReadOnly: Gauge = Object.create(Object.freeze(lookAlike()));
readThenStore("the inherited field is read-only", inheritedReadOnly);

const inheritedSetter: Gauge = Object.create({
  get level() {
    return 3;
  },
  set level(value: number) {
    trail.push("setter " + value);
  },
  unit: "above",
});
readThenStore("the inherited field is an accessor", inheritedSetter);

const texts: Gauge = JSON.parse('{"level":"a text","unit":"u"}');
readThenStore("the look-alike holds a text", texts);

class Texts {
  level = "always a text";
  unit = "texts";
}
readThenStore("a layout whose field is declared a text", new Texts() as any);
class Fractions {
  level = 0.5;
  unit = "fractions";
}
readThenStore("a layout whose field holds fractions", new Fractions());
class Flags {
  level = true;
  unit = "flags";
}
readThenStore("a layout whose field is declared a flag", new Flags() as any);

storeThenRead("store first, honest", new Gauge());
storeThenRead("store first, look-alike", lookAlike());
storeThenRead("store first, frozen look-alike", Object.freeze(lookAlike()));
storeThenRead("store first, texts", new Texts() as any);
storeThenRead("store first, look-alike", lookAlike());

export {};
