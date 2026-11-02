// The parent of these classes is one of two, so their layouts have a field for each private name of either parent.
// ts-morph is written so: two hundred classes made by mixins over one `Node` with `#compilerNode`, which every method reads.
// The reads in the long loop find the names without a call into the run time: 200,000 of them went there once.
// COUNT: operation:operationAOTPrivateGet <= 113
// COUNT: operation:operationAOTPrivateSet <= 9
class Node {
  #raw;
  #text;
  #reads = 0;
  _context;
  static #made = 0;
  constructor(context, raw) {
    this._context = context;
    this.#raw = raw;
    Node.#made++;
  }
  get raw() {
    if (this.#raw == null) throw new Error("forgotten: " + this.#text);
    return this.#raw;
  }
  wasForgotten() {
    return this.#raw == null;
  }
  forget() {
    this.#store();
    this.#raw = undefined;
  }
  replace(raw) {
    this.#raw = raw;
    return ++this.#reads;
  }
  #store() {
    this.#text = "number " + this.#raw.k;
  }
  get #double() {
    return this.#raw.k * 2;
  }
  set #double(value) {
    this.#raw = { k: value / 2 };
  }
  twice() {
    return this.#double;
  }
  setTwice(value) {
    this.#double = value;
  }
  static isNode(value) {
    return #raw in value;
  }
  static hasMethods(value) {
    return #store in value;
  }
  static made() {
    return Node.#made;
  }
}
class Other {
  #else = 1;
  get raw() {
    return { k: this.#else };
  }
  wasForgotten() {
    return false;
  }
}
const pick = process.argv.length > 50 ? 1 : 0;
const Root = [Node, Other][pick];
const Named = Base =>
  class extends Base {
    name() {
      return "n" + this.raw.k;
    }
  };
const Typed = Base =>
  class extends Base {
    _typed = true;
    #kind = "typed";
    kind() {
      return this.#kind + this.raw.k;
    }
  };
class Plain extends Root {}
class WithName extends Named(Root) {}
class WithType extends Typed(Root) {
  _own = 1;
}
class WithBoth extends Named(Typed(Root)) {
  #mine = "mine";
  mine() {
    return this.#mine + this.raw.k;
  }
}
const kinds = [Plain, WithName, WithType, WithBoth, Node];
const nodes = [];
for (let i = 0; i < 50; i++) nodes.push(new kinds[i % kinds.length]({}, { k: i }));

let sum = 0;
for (let round = 0; round < 2000; round++) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    sum += node.raw.k;
    if (node.wasForgotten()) sum--;
  }
}
for (let round = 0; round < 2000; round++) {
  for (let i = 0; i < nodes.length; i++) sum += nodes[i].replace(nodes[i].raw);
}
console.log(sum, Node.made());

const say = (label, run) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : error.message);
  }
};
const rawOf = Object.getOwnPropertyDescriptor(Node.prototype, "raw").get;

// What is stored is what is read.
say("replace", () =>
  [nodes[0].replace({ k: 100 }), nodes[0].raw.k, nodes[0].replace({ k: 101 }), nodes[0].raw.k].join(),
);
say("accessor", () => [nodes[1].twice(), nodes[1].setTwice(84), nodes[1].raw.k, nodes[1].twice()].join());
say("own names", () => [nodes[2].kind(), nodes[3].kind(), nodes[3].mine(), nodes[3].name()].join());
nodes[6].forget();
say("forgotten", () => nodes[6].raw);
say("forgotten", () => nodes[6].wasForgotten());

// Who has the names.
for (const [label, value] of [
  ["instance", nodes[3]],
  ["of the class itself", nodes[4]],
  ["object", {}],
  ["with the prototype alone", Object.create(WithBoth.prototype)],
  ["of the other parent", new Other()],
  ["proxy", new Proxy(nodes[3], {})],
  ["function", () => {}],
  ["array", []],
]) {
  say(label, () => [Node.isNode(value), Node.hasMethods(value)].join());
  say(label, () => rawOf.call(value).k);
}
say("number", () => rawOf.call(1));
say("undefined", () => rawOf.call(undefined));
say("in a number", () => Node.isNode(1));

// The names stay where they are whatever else the object takes and loses.
const shaped = [];
for (let i = 0; i < 8; i++) {
  const node = new WithBoth({}, { k: 200 + i });
  for (let j = 0; j <= i; j++) node["added" + ((i + j) % 8)] = j;
  shaped.push(node);
}
say("more properties", () => shaped.map(node => node.raw.k + ":" + Object.keys(node).length).join());
for (const node of shaped) delete node._context;
delete shaped[2].added2;
delete shaped[3]._typed;
say("fewer properties", () => shaped.map(node => node.raw.k + ":" + Object.keys(node).length).join());
for (let i = 0; i < 100; i++) shaped[4]["many" + i] = i;
say("a hundred more", () => [shaped[4].raw.k, shaped[4].mine(), shaped[4].replace({ k: 7 }), shaped[4].raw.k].join());
Object.freeze(shaped[5]);
say("frozen", () => [shaped[5].raw.k, shaped[5].replace({ k: 8 }), shaped[5].raw.k, Object.isFrozen(shaped[5])].join());
Object.setPrototypeOf(shaped[6], null);
say("without a prototype", () => [rawOf.call(shaped[6]).k, Node.isNode(shaped[6])].join());

// Two evaluations of one class: each knows its own objects alone, also through a class below whose parent is one of the two.
const make = Base =>
  class extends Base {
    #secret;
    constructor(secret) {
      super({}, { k: 0 });
      this.#secret = secret;
    }
    #read() {
      return this.#secret;
    }
    static read(value) {
      return value.#read();
    }
    static peek(value) {
      return value.#secret;
    }
    static has(value) {
      return #secret in value;
    }
  };
const First = make(Root);
const Second = make(Root);
class Below extends [First, Second][pick] {}
const made = [new First("first"), new Second("second"), new Below("below")];
for (const [label, Class] of [
  ["First", First],
  ["Second", Second],
]) {
  for (const value of made) {
    for (let again = 0; again < 3; again++) {
      say(label, () => [Class.has(value), Class.peek(value)].join());
      say(label, () => Class.read(value));
    }
  }
}

// A constructor that returns what it is given puts its names on any object.
class Stamp extends function (value) {
  return value;
} {
  #stamp = "stamped";
  static read(value) {
    return value.#stamp;
  }
  static write(value, stamp) {
    value.#stamp = stamp;
  }
  static has(value) {
    return #stamp in value;
  }
}
for (const [label, value] of [
  ["instance", nodes[8]],
  ["another of its class", nodes[13]],
  ["of the class itself", nodes[9]],
  ["object", { a: 1 }],
  ["array", [1]],
]) {
  say(label, () => Stamp.has(value));
  say(label, () => Stamp.read(value));
  new Stamp(value);
  say(label, () => [Stamp.has(value), Stamp.read(value), Stamp.write(value, "again"), Stamp.read(value)].join());
  say(label, () => new Stamp(value));
}
say("still a node", () =>
  [nodes[8].raw.k, nodes[13].raw.k, nodes[9].raw.k, nodes[8].name?.(), Node.isNode(nodes[8])].join(),
);
