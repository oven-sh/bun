class Stamper {
  constructor(object) {
    return Object.setPrototypeOf(object, new.target.prototype);
  }
}
class Node extends Stamper {
  #inner;
  #other = "other";
  constructor(object, inner) {
    super(object);
    this.#inner = inner;
  }
  static make(inner) {
    return new Node({}, inner);
  }
  get inner() {
    if (this.#inner == null) throw new Error("forgotten, beside " + this.#other);
    return this.#inner;
  }
  forget() {
    this.#inner = undefined;
  }
  set(inner) {
    this.#inner = inner;
  }
  twice() {
    return this.#inner + "," + this.#inner;
  }
  aroundAStoreThroughAnotherName(same) {
    const before = this.#inner;
    same.#inner = "stored through another name";
    return before + " > " + this.#inner;
  }
  aroundAStoreToAnotherObject(another) {
    const before = this.#inner;
    another.#inner = "stored to another object";
    return before + " > " + this.#inner + " | " + another.#inner;
  }
  aroundACall(run) {
    const before = this.#inner;
    run();
    return before + " > " + this.#inner;
  }
  aroundAStoreOfAnotherField() {
    const before = this.#inner;
    this.#other = "other, stored";
    return before + " > " + this.#inner + " | " + this.#other;
  }
  inALoop(turns) {
    const seen = [];
    for (let turn = 0; turn < turns; turn++) {
      seen.push(this.#inner);
      if (turn & 1) this.#inner = "turn " + turn;
      seen.push(this.#inner);
    }
    return seen.join(" ");
  }
  onOneWay(stores) {
    const before = this.#inner;
    if (stores) this.#inner = "stored on one way";
    return before + " > " + this.#inner;
  }
  static readTwice(object) {
    try {
      return object.#inner + "," + object.#inner;
    } catch (error) {
      return error.constructor.name;
    }
  }
}
for (let round = 0; round < 3; round++) {
  const node = Node.make("first");
  console.log(node.inner, node.twice());
  console.log(node.aroundAStoreThroughAnotherName(node));
  console.log(node.aroundAStoreToAnotherObject(Node.make("second")));
  console.log(node.aroundACall(() => node.set("stored in a call")));
  console.log(node.aroundACall(() => {}));
  console.log(node.aroundAStoreOfAnotherField());
  console.log(node.inALoop(4));
  console.log(node.onOneWay(false), "|", node.onOneWay(true));
  node.forget();
  try {
    console.log(node.inner);
  } catch (error) {
    console.log(error.message);
  }
  const list = new Node([1, 2], "on a list");
  const proxy = new Node(new Proxy({}, {}), "on a proxy");
  console.log(Array.isArray(list), list.inner, list.twice(), proxy.inner, proxy.twice());
  console.log(Node.readTwice(node), Node.readTwice(list), Node.readTwice({}), Node.readTwice(null), Node.readTwice(new Proxy(list, {})));
}
