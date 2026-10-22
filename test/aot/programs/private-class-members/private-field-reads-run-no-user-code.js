// The read of a private field is told apart from the read of a private accessor or method: only the first is known to run no code of the program's.
// IR= 1 field PrivateGet v[0-9]+, v[0-9]+ layout=L[0-9]+ privateField=
// IR= 0 field PrivateGet v[0-9]+, v[0-9]+( @|$)
// IR= 1 accessor PrivateGet v[0-9]+, v[0-9]+( @|$)
// IR= 0 accessor PrivateGet v[0-9]+, v[0-9]+ layout=L[0-9]+ privateField=
// IR= 1 method PrivateGet v[0-9]+, v[0-9]+( @|$)
// IR= 0 method PrivateGet v[0-9]+, v[0-9]+ layout=L[0-9]+ privateField=
const calls = [];
class Holder {
  #field = "field";
  get #accessor() {
    calls.push("get");
    return "accessor";
  }
  set #accessor(value) {
    calls.push("set " + value);
  }
  #method() {
    return "method";
  }
  field() {
    return this.#field;
  }
  accessor() {
    return this.#accessor;
  }
  method() {
    return this.#method;
  }
  twice() {
    return [this.#field, this.#accessor, this.#field, this.#accessor];
  }
  store(value) {
    const before = this.#field;
    this.#field = value;
    this.#accessor = value;
    return [before, this.#field];
  }
  static fieldOf(other) {
    return other.#field;
  }
  static has(other) {
    return #field in other;
  }
}
const usedAsValues = [Holder.prototype.field, Holder.prototype.accessor, Holder.prototype.method];
const outcome = work => {
  try {
    return work();
  } catch (error) {
    return "throws " + error.constructor.name;
  }
};
const holder = new Holder();
console.log(usedAsValues.map(each => each.name).join());
console.log(holder.field(), holder.accessor(), typeof holder.method(), holder.method().call(holder));
console.log(JSON.stringify(holder.twice()), JSON.stringify(calls));
console.log(JSON.stringify(holder.store("stored")), JSON.stringify(calls));
console.log(Holder.fieldOf(holder), Holder.has(holder), Holder.has({}));
for (const other of [{}, null, undefined, 1, "text", Object.create(holder), new Proxy(holder, {})]) console.log(outcome(() => Holder.fieldOf(other)), outcome(() => Holder.prototype.field.call(other)));
class Base {
  constructor(object) {
    return object;
  }
}
class Stamper extends Base {
  #stamp = "stamped";
  static read(object) {
    return object.#stamp;
  }
}
const plain = {};
console.log(outcome(() => Stamper.read(plain)));
new Stamper(plain);
console.log(outcome(() => Stamper.read(plain)), outcome(() => new Stamper(plain)));
function makeClass() {
  return class {
    #own = "own";
    static read(object) {
      return object.#own;
    }
  };
}
const First = makeClass(), Second = makeClass();
console.log(First.read(new First()), outcome(() => First.read(new Second())));
