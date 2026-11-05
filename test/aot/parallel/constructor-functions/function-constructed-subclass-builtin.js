// A function constructed for a class below a built in makes an ordinary object.
function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.constructor.name);
  }
}

var MakePoint = function () {
  this.x = 1;
};
class List extends Array {}
console.log(Reflect.construct(MakePoint, [], List).length);

var point = Reflect.construct(MakePoint, [], List);
console.log(
  point.length,
  Array.isArray(point),
  point instanceof List,
  point instanceof Array,
  point.x,
  Object.keys(point).join(),
);
console.log(point.push(7), point.length, point[0], Object.keys(point).join());
console.log(
  Object.getPrototypeOf(point) === List.prototype,
  Object.prototype.toString.call(point),
  JSON.stringify(point),
);
function lengthOf(list) {
  return list.length;
}
console.log(lengthOf(new List(1, 2, 3)), lengthOf(point), Array.isArray(new List()));

let MakeEntry = function () {
  this.key = "k";
};
class Table extends Map {}
const entry = Reflect.construct(MakeEntry, [], Table);
console.log(entry.key, entry instanceof Table, entry instanceof Map, new Table([[1, 2]]).size);
show("size of what is no map", () => entry.size);
show("get of what is no map", () => entry.get("k"));

var MakeLater = function () {
  this.state = "made";
};
class Later extends Promise {}
const later = Reflect.construct(MakeLater, [], Later);
console.log(later.state, later instanceof Promise, typeof later.then);
show("then of what is no promise", () => later.then(() => 1));

var MakeFailure = function () {
  this.code = 5;
};
class Failure extends Error {}
const failure = Reflect.construct(MakeFailure, [], Failure);
console.log(
  failure.code,
  JSON.stringify(failure.message),
  failure instanceof Error,
  String(failure),
  Object.keys(failure).join(),
  Object.prototype.toString.call(failure),
);
console.log(new Failure("real").message);

var MakeBytes = function () {
  this.tag = "bytes";
};
class Bytes extends Uint8Array {}
const bytes = Reflect.construct(MakeBytes, [], Bytes);
console.log(bytes.tag, bytes[0], ArrayBuffer.isView(bytes), bytes instanceof Uint8Array, new Bytes(4).length);
show("length of what is no typed array", () => bytes.length);
show("fill of what is no typed array", () => bytes.fill(1));

var MakeCallable = function () {
  this.made = true;
};
class Callable extends Function {}
const callable = Reflect.construct(MakeCallable, [], Callable);
console.log(
  typeof callable,
  callable.length,
  JSON.stringify(callable.name),
  callable.made,
  callable instanceof Function,
);
show("a call of what is no function", () => callable());
show("call of what is no function", () => callable.call(null));

var MakeHalf = function () {
  this.left = 10;
};
class Pair {
  left = 1;
  right = 2;
  sum() {
    return this.left + this.right;
  }
}
class Triple extends Pair {
  last = 3;
}
const half = Reflect.construct(MakeHalf, [], Pair);
const third = Reflect.construct(MakeHalf, [], Triple);
console.log(half.left, half.right, half.sum(), Object.keys(half).join(), new Pair().sum());
console.log(third.left, third.right, third.last, third.sum(), third instanceof Pair, Object.keys(new Triple()).join());

var MakeUnderBound = function () {
  this.x = 2;
};
class BoundList extends Array {}
const underBound = Reflect.construct(MakeUnderBound, [], BoundList.bind(null));
console.log(
  underBound.length,
  underBound.x,
  underBound instanceof Array,
  Object.getPrototypeOf(underBound) === Object.prototype,
);

var MakeUnderProxy = function () {
  this.x = 3;
};
class ProxiedList extends Array {}
const asked = [];
const underProxy = Reflect.construct(
  MakeUnderProxy,
  [],
  new Proxy(ProxiedList, {
    get(target, key, receiver) {
      asked.push(String(key));
      return Reflect.get(target, key, receiver);
    },
  }),
);
console.log(
  underProxy.length,
  underProxy.x,
  Array.isArray(underProxy),
  underProxy instanceof ProxiedList,
  asked.join(),
);

class OtherList extends Array {}
show("an arrow function", () => Reflect.construct(() => {}, [], OtherList).length);
show("an async function", () => Reflect.construct(async function () {}, [], OtherList).length);
show("a generator function", () => Reflect.construct(function* () {}, [], OtherList).length);
show("a method", () => Reflect.construct({ method() {} }.method, [], OtherList).length);
class Base {
  constructor() {
    this.x = 4;
  }
}
const ofBase = Reflect.construct(Base, [], OtherList);
console.log(ofBase.length, ofBase.x, Array.isArray(ofBase), ofBase instanceof OtherList, ofBase instanceof Base);

var Plain = function () {
  this.x = 5;
};
const arrayForPlain = Reflect.construct(Array, [2], Plain);
const listForPlain = Reflect.construct(OtherList, [3], Plain);
console.log(
  arrayForPlain.length,
  Array.isArray(arrayForPlain),
  arrayForPlain instanceof Array,
  arrayForPlain instanceof Plain,
  arrayForPlain.x,
);
console.log(
  listForPlain.length,
  Array.isArray(listForPlain),
  listForPlain instanceof OtherList,
  listForPlain instanceof Plain,
  listForPlain.x,
);

var MakeRow = function () {
  this.cells = 2;
};
class Row extends Array {}
Object.setPrototypeOf(Row, MakeRow);
const row = new Row(9);
console.log(row.length, Array.isArray(row), row.cells, row instanceof Row, row instanceof Array);

var MakeAnswer = function () {
  this.x = 6;
  return [1, 2];
};
class AnswerList extends Array {}
const answer = Reflect.construct(MakeAnswer, [], AnswerList);
console.log(answer.length, Array.isArray(answer), answer instanceof AnswerList, answer.x);

var MakeUnderLonger = function () {
  this.x = 7;
};
class Longer extends List {
  extra = 1;
}
const underLonger = Reflect.construct(MakeUnderLonger, [], Longer);
console.log(
  underLonger.length,
  underLonger.extra,
  Array.isArray(underLonger),
  underLonger.x,
  new Longer(2).length,
  new Longer().extra,
);

var MakeUnderEither = function () {
  this.x = 8;
};
class FromEither extends (process.argv.length > 100 ? Map : Array) {}
const underEither = Reflect.construct(MakeUnderEither, [], FromEither);
console.log(underEither.length, Array.isArray(underEither), underEither.x, new FromEither(2).length);

var MakeUnderMixed = function () {
  this.x = 9;
};
const mix = Above =>
  class extends Above {
    mixed = 1;
  };
class Mixed extends mix(Array) {}
const underMixed = Reflect.construct(MakeUnderMixed, [], Mixed);
console.log(
  underMixed.length,
  underMixed.mixed,
  Array.isArray(underMixed),
  underMixed.x,
  new Mixed(2).length,
  new Mixed().mixed,
);

var Parent = function () {
  this.x = 10;
};
class Child extends Parent {}
class Stranger extends Array {}
for (const each of [
  Reflect.construct(Parent, [], Child),
  Reflect.construct(Parent, [], Stranger),
  new Child(),
  new Parent(),
])
  console.log(each.length, each.x, each instanceof Parent, Array.isArray(each));

function total(list) {
  let sum = 0;
  for (let index = 0; index < list.length; index++) sum += list[index];
  return sum;
}
var MakeNoNumbers = function () {
  this.x = 11;
};
class Numbers extends Array {}
let sum = 0;
for (let round = 0; round < 1000; round++)
  sum += total(Numbers.of(1, 2, 3)) + total(Reflect.construct(MakeNoNumbers, [], Numbers));
console.log(sum);
