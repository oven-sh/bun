// Defaults, or members written in the literal, are overwritten by the spread of options that hold some of the names, over and over, by functions that a table hands out.
// Now and then an option holds undefined, null, a number at the edge of what a small slot takes, or a value of another kind, in front of or behind options of the usual kind.
interface Options {
  depth: number;
  width: number;
  name: string;
  on: boolean;
  next: object | null;
}
interface Some {
  width?: number;
  name?: string;
  on?: boolean;
  next?: object | null;
  depth?: number;
}
const marker = { marker: true };
const defaults: Options = { depth: 3, width: 4, name: "default", on: false, next: null };
const merges: Record<string, (source: any, i: number) => object> = {
  defaultsAndSome: (source): Options => {
    const some: Some = source;
    return { ...defaults, ...some };
  },
  membersAndSome: (source, i): Options => {
    const some: Some = source;
    return { depth: i, width: 0, name: "", on: false, next: marker, ...some };
  },
  someAndSome: (source): Some => {
    const some: Some = source;
    return { ...some, ...some };
  },
  defaultsSomeAndAMember: (source, i): Options => {
    const some: Some = source;
    return { ...defaults, ...some, depth: i };
  },
  untyped: source => ({ ...defaults, ...source }),
};

function show(value: object): string {
  return JSON.stringify(
    Reflect.ownKeys(value).map(key => {
      const held = (value as any)[key];
      return [String(key), Object.is(held, -0) ? "-0" : held === undefined ? "undefined" : typeof held === "number" ? String(held) : held];
    }),
  );
}

const usual: (() => any)[] = [
  () => ({ width: 9, name: "part" }),
  () => ({ name: "piece", width: 10 }),
  () => ({ width: 11, name: "all", on: true, next: marker, depth: 12 }),
  () => ({ on: true }),
  () => ({}),
];
const changes: Record<string, (some: any) => void> = {
  nothing: () => {},
  undefinedName: some => void (some.name = undefined),
  nullName: some => void (some.name = null),
  undefinedWidth: some => void (some.width = undefined),
  nullWidth: some => void (some.width = null),
  smallestWidth: some => void (some.width = -(2 ** 31)),
  nearlySmallestWidth: some => void (some.width = -(2 ** 31) + 4),
  largeWidth: some => void (some.width = 2 ** 31),
  fraction: some => void (some.width = 0.5),
  negativeZero: some => void (some.width = -0),
  textWidth: some => void (some.width = "wide"),
  numberName: some => void (some.name = 7),
  undefinedOn: some => void (some.on = undefined),
  numberOn: some => void (some.on = 1),
  undefinedNext: some => void (some.next = undefined),
  nullNext: some => void (some.next = null),
  numberNext: some => void (some.next = 5),
  removed: some => void delete some.width,
  removedAndBack: some => {
    delete some.name;
    some.name = "back";
  },
  getter: some => void Object.defineProperty(some, "width", { get: () => 42, enumerable: true, configurable: true }),
  hidden: some => void Object.defineProperty(some, "name", { enumerable: false }),
  added: some => void (some.late = 1),
  frozen: some => void Object.freeze(some),
};

const kept: object[] = [];
let lines = 0;
for (const merge in merges) {
  for (let kind = 0; kind < usual.length; kind++) {
    for (const change in changes) {
      let last = "";
      for (let i = 0; i < 12; i++) {
        kept[i & 7] = merges[merge](usual[kind](), i);
        const some = usual[kind]();
        if (i % 4 === 3) changes[change](some);
        const made = merges[merge](some, i);
        kept[(i + 1) & 7] = made;
        if (i % 4 === 3) last = show(made) + " " + show(kept[i & 7]) + " " + show(defaults);
      }
      console.log(merge, kind, change, last);
      lines++;
    }
  }
}
console.log(lines, kept.length);
