// Object literals with getters, setters, methods, generators and async methods beside plain fields. Each evaluation makes new functions over the variables of that evaluation; reads and stores that expect a plain field run the accessors.
interface Reading {
  raw: number;
  scaled: number;
  unit: string;
  describe(): string;
}

const trail: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

function plain(raw: number): Reading {
  return {
    raw,
    scaled: raw * 10,
    unit: "plain",
    describe() {
      return this.unit + " " + this.raw + " " + this.scaled;
    },
  };
}
function computed(raw: number): Reading {
  let stored = -1;
  return {
    raw,
    get scaled() {
      trail.push("get scaled of " + this.raw);
      return stored < 0 ? this.raw * 10 : stored;
    },
    set scaled(value: number) {
      trail.push("set scaled " + value);
      stored = value;
    },
    unit: "computed",
    describe() {
      return this.unit + " " + this.raw + " " + this.scaled;
    },
  };
}
function readOnly(raw: number): Reading {
  return {
    get raw() {
      return raw;
    },
    get scaled() {
      return raw * 100;
    },
    get unit() {
      return "read-only";
    },
    describe: () => "an arrow over " + raw,
  } as Reading;
}
function writeOnly(raw: number): Reading {
  return {
    raw,
    set scaled(value: number) {
      trail.push("write-only " + value);
    },
    unit: "write-only",
    describe() {
      return String(this.scaled);
    },
  } as Reading;
}

function scaledOf(reading: Reading): number {
  return reading.scaled;
}
function setScaled(reading: Reading, value: number): void {
  reading.scaled = value;
}
function setRaw(reading: Reading, value: number): void {
  reading.raw = value;
}
function describe(reading: Reading): string {
  return reading.describe();
}
function look(mark: string, reading: Reading): void {
  console.log(mark + ":", attempt(() => scaledOf(reading)), attempt(() => describe(reading)), attempt(() => setScaled(reading, 7)), attempt(() => scaledOf(reading)), attempt(() => setRaw(reading, 2)), attempt(() => describe(reading)), JSON.stringify(reading), Object.keys(reading).join(), "|", trail.splice(0).join(";"));
}

look("plain", plain(1));
look("computed", computed(1));
look("plain", plain(1));
look("read-only", readOnly(1));
look("write-only", writeOnly(1));
look("computed", computed(3));
look("plain", plain(1));

const first = computed(1);
const second = computed(1);
setScaled(first, 50);
console.log(scaledOf(first), scaledOf(second), first.describe === second.describe, Object.getOwnPropertyDescriptor(first, "scaled")!.get === Object.getOwnPropertyDescriptor(second, "scaled")!.get, trail.splice(0).length);

const kinds = {
  plainMethod() {
    return "method";
  },
  *generator() {
    yield "generated";
  },
  async asyncMethod() {
    return "awaited";
  },
  async *asyncGenerator() {
    yield "generated and awaited";
  },
  arrow: () => "arrow",
  ["computed" + "Method"]() {
    return "computed";
  },
  0() {
    return "zero";
  },
  "quoted name"() {
    return "quoted";
  },
};
console.log(kinds.plainMethod(), [...kinds.generator()].join(), await kinds.asyncMethod(), (await kinds.asyncGenerator().next()).value, kinds.arrow(), (kinds as any).computedMethod(), kinds[0](), kinds["quoted name"]());
console.log(Object.keys(kinds).join(), kinds.plainMethod.name, kinds.generator.name, kinds.arrow.name, (kinds as any).computedMethod.name, kinds[0].name, kinds["quoted name"].name, "prototype" in kinds.plainMethod, "prototype" in kinds.generator);

export {};
