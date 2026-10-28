// Copying a non-extensible, sealed or frozen object yields an extensible copy, even when the source gained keys through computed names.
const name: string = process.argv[2] ?? "z";
const index: number = Number(process.argv[3] ?? 5);
const symbol = Symbol("symbol");

const fill: [string, (source: any) => void][] = [
  ["nothing", () => {}],
  [
    "a name",
    source => {
      source[name] = 2;
    },
  ],
  [
    "a name that is deleted again",
    source => {
      source[name] = 2;
      delete source[name];
    },
  ],
  [
    "a name and a symbol",
    source => {
      source[name] = 2;
      source[symbol] = 3;
    },
  ],
  [
    "a name behind a deleted member",
    source => {
      delete source.a;
      source[name] = 2;
    },
  ],
  [
    "an index",
    source => {
      source[index] = 4;
    },
  ],
  [
    "a dozen names",
    source => {
      for (let i = 0; i < 12; i++) source[name + i] = i;
    },
  ],
];

const close: [string, (source: any) => void][] = [
  ["preventExtensions", Object.preventExtensions],
  ["seal", Object.seal],
  ["freeze", Object.freeze],
];

const copy: [string, (source: any) => any][] = [
  ["spread", source => ({ ...source })],
  ["spread, then an index", source => ({ ...source, 1: 1 })],
  ["spread, then a name", source => ({ ...source, last: 1 })],
  ["spread twice", source => ({ ...source, ...source })],
  [
    "rest",
    source => {
      const { ...rest } = source;
      return rest;
    },
  ],
  ["Object.assign to an empty object", source => Object.assign({}, source)],
  ["Object.assign to the same members", source => Object.assign({ a: 0, b: "" }, source)],
];

const write: [string, (target: any) => unknown][] = [
  [
    "a name",
    target => {
      target.added = 1;
    },
  ],
  [
    "an index",
    target => {
      target[0] = "x";
    },
  ],
  [
    "a symbol",
    target => {
      target[Symbol.for("added")] = 1;
    },
  ],
  ["Reflect.set of an index", target => Reflect.set(target, 0, "x")],
  ["Reflect.defineProperty of an index", target => Reflect.defineProperty(target, 3, { value: 1, enumerable: true })],
  [
    "Reflect.defineProperty of a name",
    target => Reflect.defineProperty(target, "defined", { value: 1, enumerable: true }),
  ],
  ["push", target => Array.prototype.push.call(target, 1)],
  [
    "Object.assign",
    target => {
      Object.assign(target, { added: 1, 2: 2 });
    },
  ],
  ["delete", target => delete target.b],
  ["Reflect.setPrototypeOf", target => Reflect.setPrototypeOf(target, null)],
];

for (const [filled, fillSource] of fill) {
  for (const [closed, closeSource] of close) {
    for (const [copied, copySource] of copy) {
      for (const [written, writeTarget] of write) {
        const source: any = { a: 1, b: "x" };
        fillSource(source);
        closeSource(source);
        const target = copySource(source);
        let result: unknown;
        try {
          result = writeTarget(target);
        } catch (error: any) {
          result = error.constructor.name;
        }
        const keys = Reflect.ownKeys(target);
        console.log(
          `${filled} | ${closed} | ${copied} | ${written}: ${String(result)} ${Object.isExtensible(target)} ${Object.isExtensible(source)} ${keys.length} ${keys.slice(0, 8).map(String).join()}`,
        );
      }
    }
  }
}
