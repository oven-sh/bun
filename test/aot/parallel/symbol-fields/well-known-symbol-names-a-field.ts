// Fields under Symbol.toStringTag, Symbol.iterator and Symbol.toPrimitive are read by built-ins, which must find what the constructor has stored.
export {};

class Tagged {
  [Symbol.toStringTag]!: string;
  [Symbol.iterator]!: () => Iterator<number>;
  [Symbol.toPrimitive]!: (hint: string) => number | string;
  constructor(tag: string, count: number) {
    this[Symbol.toStringTag] = tag;
    this[Symbol.iterator] = function* () {
      for (let index = 0; index < count; index++) yield index;
    };
    this[Symbol.toPrimitive] = hint => (hint === "number" ? count : tag);
  }
}
const tagged = new Tagged("Mine", 3);
console.log(
  Object.prototype.toString.call(tagged),
  [...tagged].join(),
  +tagged,
  `${tagged}`,
  Object.getOwnPropertySymbols(tagged).map(String).join(),
);
tagged[Symbol.toStringTag] = "Other";
delete (tagged as any)[Symbol.iterator];
let spread: string;
try {
  spread = [...tagged].join();
} catch (error) {
  spread = (error as Error).name;
}
console.log(String(Object.prototype.toString.call(tagged)), spread);
