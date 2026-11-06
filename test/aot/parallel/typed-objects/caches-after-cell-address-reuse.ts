// What the runtime remembers about constructors, prototypes, setters, runs of stores, letter cases and added properties holds for the objects that are still alive, through any mix of collections, and never for new objects born where dead ones lay.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
let wrong = 0;
let checked = 0;
function expect(actual: unknown, expected: unknown): void {
  checked++;
  if (actual !== expected) wrong++;
}

interface Made {
  stored: number;
  value: number;
  readonly generation: number;
  readonly madeDirectly: boolean;
}
type Maker = new () => Made;

function makeClasses(generation: number, index: number): [Maker, Maker] {
  class Base implements Made {
    stored = 0;
    madeDirectly: boolean;
    constructor() {
      this.madeDirectly = new.target === Base;
    }
    get generation(): number {
      return generation * 100 + index;
    }
    get value(): number {
      return this.stored;
    }
    set value(next: number) {
      this.stored = next + generation * 1000 + index;
    }
  }
  class Derived extends Base {
    more = generation + index;
  }
  return [Base, Derived];
}

interface Family {
  generation: number;
  makers: [Maker, Maker][];
  prototypes: { generation: number; index: number }[];
  texts: string[];
  bags: Record<string, number>[];
  kept: Made[];
}

function makeFamily(generation: number): Family {
  const family: Family = { generation, makers: [], prototypes: [], texts: [], bags: [], kept: [] };
  for (let index = 0; index < 14; index++) {
    family.makers.push(makeClasses(generation, index));
    family.prototypes.push({ generation, index });
    family.texts.push("Word" + generation + "x" + index);
  }
  return family;
}

function use(family: Family, isFirstUse: boolean): void {
  const generation = family.generation;
  for (let turn = 0; turn < 4; turn++) {
    for (let index = 0; index < family.makers.length; index++) {
      const [Base, Derived] = family.makers[index];
      const base = new Base();
      const derived = new Derived();
      const crossed = Reflect.construct(Base, [], Derived) as Made;
      expect(base.madeDirectly, true);
      expect(derived.madeDirectly, false);
      expect(crossed.madeDirectly, false);
      expect(Object.getPrototypeOf(base), Base.prototype);
      expect(Object.getPrototypeOf(derived), Derived.prototype);
      expect(Object.getPrototypeOf(crossed), Derived.prototype);
      expect(derived.generation, generation * 100 + index);
      derived.value = turn;
      expect(derived.stored, turn + generation * 1000 + index);
      crossed.value = turn + 1;
      expect(crossed.value, turn + 1 + generation * 1000 + index);

      const added = derived as unknown as Record<string, number>;
      added["added" + (generation % 3)] = generation + turn;
      expect(added["added" + (generation % 3)], generation + turn);
      expect(added["added" + ((generation + 1) % 3)], undefined);
      if (isFirstUse && turn === 3) family.kept.push(derived);

      const prototype = family.prototypes[index];
      const heir = Object.create(prototype) as { generation: number; index: number };
      expect(Object.getPrototypeOf(heir), prototype);
      expect(heir.generation * 100 + heir.index, generation * 100 + index);
      expect(Object.keys(heir).length, 0);

      const text = family.texts[index];
      expect(text.toUpperCase(), "WORD" + generation + "X" + index);
      expect(text.toLowerCase(), "word" + generation + "x" + index);
      const fresh = "Fresh" + generation + "y" + index + "z" + turn;
      expect(fresh.toUpperCase(), "FRESH" + generation + "Y" + index + "Z" + turn);
      expect(fresh.toLowerCase(), "fresh" + generation + "y" + index + "z" + turn);

      const bag: Record<string, number> = {};
      bag["g" + generation + "i" + (index % 5)] = generation;
      bag.first = index;
      bag.second = turn;
      bag.third = generation;
      expect(Object.keys(bag).join(), "g" + generation + "i" + (index % 5) + ",first,second,third");
      expect(bag.first + bag.second * 100 + bag.third * 10000, index + turn * 100 + generation * 10000);
      if (isFirstUse && turn === 0) family.bags.push(bag);
    }
  }
  for (let index = 0; index < family.kept.length; index++) {
    const kept = family.kept[index];
    expect(kept.generation, generation * 100 + index);
    expect((kept as unknown as Record<string, number>)["added" + (generation % 3)], generation + 3);
    kept.value = 7;
    expect(kept.stored, 7 + generation * 1000 + index);
  }
  for (let index = 0; index < family.bags.length; index++) expect(family.bags[index].third, generation);
}

const survivors: Family[] = [];
let junk = 0;
for (let generation = 1; generation <= 60; generation++) {
  const family = makeFamily(generation);
  use(family, true);
  if (generation % 4 === 0) survivors.push(family);
  if (survivors.length > 5) survivors.shift();
  collect(generation % 5 === 0);
  for (const survivor of survivors) use(survivor, false);
  for (let i = 0; i < 3000; i++) junk += ("junk" + (i % 17)).length + Object.keys({ a: i, b: generation }).length;
  collect(false);
  collect(false);
  for (const survivor of survivors) use(survivor, false);
}
console.log(checked, wrong, survivors.length, junk);
