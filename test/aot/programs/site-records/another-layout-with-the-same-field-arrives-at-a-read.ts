// A read that expects one layout gets objects of other layouts: the field stands in another slot, is kept in another form, or is missing.
interface Options {
  name: string;
  retries: number;
  verbose: boolean;
  tag: string;
}

class Plain {
  name = "plain";
  retries = 1;
  verbose = false;
  tag = "p";
}
class Reordered {
  tag = "r";
  verbose = true;
  retries = 2.5;
  name = "reordered";
}
class Wider {
  before = 0.5;
  name = "wider";
  between = [1];
  retries = 3;
  verbose = false;
  after: null | string = null;
  tag = "w";
}
class OtherKinds {
  name: unknown = 7;
  retries: unknown = "four";
  verbose: unknown = null;
  tag: unknown = { inner: "t" };
}
class Fewer {
  name = "fewer";
}

function describe(options: Options): string {
  const name = options.name;
  const retries = options.retries;
  const verbose = options.verbose;
  const tag = options.tag;
  return typeof name + " " + String(name) + " | " + typeof retries + " " + String(retries) + " | " + typeof verbose + " " + String(verbose) + " | " + typeof tag + " " + JSON.stringify(tag);
}

const literal: Options = { name: "literal", retries: 0, verbose: true, tag: "l" };
const reordered = new Reordered();
const wider = new Wider();
const otherKinds = new OtherKinds() as any;
const fewer = new Fewer() as any;

console.log("expected:", describe(literal));
console.log("plain:", describe(new Plain()));
console.log("reordered:", describe(reordered));
console.log("reordered again:", describe(reordered));
console.log("wider:", describe(wider));
console.log("reordered after wider:", describe(reordered));
console.log("expected again:", describe(literal));
console.log("other kinds:", describe(otherKinds));
console.log("other kinds again:", describe(otherKinds));
console.log("fewer:", describe(fewer));
console.log("fewer again:", describe(fewer));
console.log("wider after fewer:", describe(wider));
console.log("expected at last:", describe(literal));

export {};
