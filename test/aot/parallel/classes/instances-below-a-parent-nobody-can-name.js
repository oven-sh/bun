// The parent of these classes is one of two, so their layouts have no field for what the parent declares, and each private name of the parent is put beside the fields when an instance is made.
// The sites stand in the parent's own constructor, where the compiler takes an instance of another class for rare. Six definitions and a store an instance went to the run time once: 1,400,000 calls here.
// What is left are the first instances of each class, the instances for which an allocator had no cell at hand, and all 50,000 of C, two names each: they are not served yet.
// COUNT: operation:operationAOTPrivateDefine <= 101000
// COUNT: operation:operationAOTPrivateSet <= 200
class Node {
  #raw;
  #text;
  #ranges;
  #leading = "leading";
  #trailing;
  _count = 0;
  _context;
  constructor(context, raw) {
    this._context = context;
    this.#raw = raw;
  }
  #store() {
    return this.#leading;
  }
  get raw() {
    return this.#raw;
  }
  all() {
    return [
      this.#raw.k,
      this.#text,
      this.#ranges,
      this.#store(),
      this.#trailing,
      this._count,
      typeof this._context,
    ].join();
  }
}
class Plain {
  #only = "only";
  #other;
  constructor(context, raw) {
    this.#other = raw;
  }
  get raw() {
    return this.#other;
  }
  all() {
    return [this.#only, this.#other.k].join();
  }
}
const pick = process.argv.length > 50 ? 1 : 0;
const Root = [Node, Plain][pick];
const Bare = [Plain, Node][pick];
const Named = Base => class extends Base {};
class A extends Named(Root) {}
class B extends Root {
  own = 1;
}
class C extends Named(Bare) {
  #mine = 2;
  mine() {
    return this.#mine;
  }
}
const kinds = [A, B, C, Node];
const context = {};
let sum = 0;
let last = [];
for (let i = 0; i < 200000; i++) {
  const made = new kinds[i & 3](context, { k: i & 7 });
  sum += made.raw.k;
  if (i >= 199996) last.push(made);
}
console.log(sum);
for (const made of last) console.log(made.constructor.name, made.all(), Object.keys(made).join(), made.mine?.());

// An instance that takes no more properties takes private names all the same, and one that has them takes them once.
class Sealer {
  constructor() {
    return Object.preventExtensions(new A(context, { k: 1 }));
  }
}
class Stamp extends Sealer {
  #stamp = "stamp";
  static read(value) {
    return value.#stamp;
  }
}
class Again extends function (value) {
  return value;
} {
  #again = 1;
  static has(value) {
    return #again in value;
  }
}
for (let i = 0; i < 3; i++) console.log(Stamp.read(new Stamp()), Object.isExtensible(new Stamp()));
for (let i = 0; i < 3; i++) {
  const made = new B(context, { k: i });
  new Again(made);
  try {
    new Again(made);
  } catch (error) {
    console.log(error instanceof TypeError, Again.has(made), made.all());
  }
}
