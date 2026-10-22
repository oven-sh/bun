// The declared optional fields of this class and of this interface are called toString, valueOf, constructor, hasOwnProperty, isPrototypeOf, toLocaleString and __proto__.
// An empty slot under such a name does not read as undefined: Object.prototype has the name. A store to __proto__ makes no property at all: it calls the setter up there.
class Odd {
  declare id: number;
  declare toString?: () => string;
  declare valueOf?: () => number;
  declare hasOwnProperty?: (name: PropertyKey) => boolean;
  declare isPrototypeOf?: (object: object) => boolean;
  declare toLocaleString?: () => string;
  constructor(id: number) {
    this.id = id;
  }
}
interface Loose {
  id: number;
  toString?: () => string;
  valueOf?: () => Object;
  constructor?: Function;
  __proto__?: object | null;
}
function kinds(odd: Odd) {
  return [odd.toString, odd.valueOf, odd.hasOwnProperty, odd.isPrototypeOf, odd.toLocaleString].map(member => typeof member).join();
}
function same(odd: Odd) {
  const top = Object.prototype;
  return [odd.toString === top.toString, odd.valueOf === (top.valueOf as unknown), odd.hasOwnProperty === top.hasOwnProperty, odd.isPrototypeOf === top.isPrototypeOf, odd.toLocaleString === top.toLocaleString].join();
}
function textOf(odd: Odd) {
  return odd.toString ? odd.toString() : "no toString";
}
function callOptional(odd: Odd) {
  return `${odd.toString?.()} ${typeof odd.valueOf?.()} ${odd.hasOwnProperty?.("id")} ${odd.toLocaleString?.()}`;
}
function setText(odd: Odd, f: () => string) {
  odd.toString = f;
}
function orDefault(odd: Odd) {
  return (odd.valueOf ??= () => 42);
}
function looseKinds(loose: Loose) {
  return `${typeof loose.toString} ${typeof loose.valueOf} ${loose.constructor === Object} ${loose.__proto__ === Object.prototype} [${Object.keys(loose)}]`;
}
function link(loose: Loose, above: object | null) {
  loose.__proto__ = above;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const odd = new Odd(i & 7);
  length += kinds(odd).length + textOf(odd).length + `${odd}`.length;
  if (i & 1) setText(odd, () => "own");
  length += textOf(odd).length + `${odd}`.length + looseKinds({ id: i }).length;
}
console.log("warm", length);

const empty = new Odd(1);
console.log("empty slots:", kinds(empty), "|", same(empty), "|", textOf(empty), "|", callOptional(empty), "|", `${empty}`, Object.keys(empty).join());
console.log("in and own:", "toString" in empty, Object.hasOwn(empty, "toString"), "valueOf" in empty, Object.hasOwn(empty, "valueOf"));
console.log("??= keeps what is inherited:", orDefault(empty) === (Object.prototype.valueOf as unknown), Object.keys(empty).join());
setText(empty, () => "my own text");
empty.hasOwnProperty = () => false;
console.log("stored:", kinds(empty), "|", same(empty), "|", textOf(empty), "|", callOptional(empty), "|", `${empty}`, Object.keys(empty).join());
delete empty.toString;
delete empty.hasOwnProperty;
console.log("deleted:", same(empty), "|", textOf(empty), "|", Object.keys(empty).join());

const loose: Loose = { id: 1 };
console.log("a literal:", looseKinds(loose));
loose.constructor = Odd;
loose.valueOf = () => 7;
console.log("stored:", looseKinds(loose), +(loose as any) + 1);
const above = { inherited: true, toString: () => "from above" };
link(loose, above);
console.log("a store to __proto__:", Object.getPrototypeOf(loose) === above, Object.hasOwn(loose, "__proto__"), (loose as any).inherited, loose.toString!(), Object.keys(loose).join());
link(loose, null);
console.log("null:", Object.getPrototypeOf(loose), loose.__proto__, typeof loose.toString, Object.keys(loose).join());
link(loose, above);
console.log("no setter is left:", Object.getPrototypeOf(loose), loose.__proto__ === above, Object.keys(loose).join());
const written: Loose = { id: 2, __proto__: above };
const computed: Loose = { id: 3, ["__proto__"]: above };
console.log("in literals:", Object.getPrototypeOf(written) === above, Object.keys(written).join(), "|", Object.getPrototypeOf(computed) === Object.prototype, Object.keys(computed).join());
