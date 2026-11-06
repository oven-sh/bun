// `new` makes an object for a function that never names `this`, whoever constructs it: text made at run time, Reflect.construct, a class below it.
const nothing = String(Date.now()).slice(99);
function show(label, object) {
  const prototype = Object.getPrototypeOf(object);
  console.log(
    label,
    typeof object,
    Reflect.ownKeys(object).join(),
    JSON.stringify(object),
    prototype === null ? "null" : Reflect.ownKeys(prototype).join(),
  );
}

const NullObject = function () {};
NullObject.prototype = Object.create(null);
const createParams = new Function(
  "NullObject",
  "return function (values) { const params = new NullObject(); params['shop'] = values[0]; params['order'] = values[1]; return params; }" +
    nothing,
)(NullObject);
let sum = 0;
for (let i = 0; i < 300; i++) {
  const params = createParams(["west", i]);
  sum += params.order + params.shop.length;
  if (i % 100 === 0) show("params", params);
}
console.log(
  sum,
  createParams([1, 2]) === createParams([1, 2]),
  createParams([1, 2]) instanceof NullObject,
  "toString" in createParams([1, 2]),
);

function Plain() {}
const construct = new Function("F", "return new F()" + nothing);
const first = construct(Plain);
show("plain", first);
console.log(first instanceof Plain, first.constructor === Plain, Object.getPrototypeOf(first) === Plain.prototype);

// The prototype is read at each construction.
Plain.prototype.greet = function () {
  return "hello";
};
console.log(construct(Plain).greet());
const before = Plain.prototype;
Plain.prototype = { other: true };
const second = construct(Plain);
show("other prototype", second);
console.log(second instanceof Plain, first instanceof Plain, Object.getPrototypeOf(first) === before, second.other);
Plain.prototype = 5;
console.log(Object.getPrototypeOf(construct(Plain)) === Object.prototype);
Plain.prototype = before;
console.log(construct(Plain).greet());

// What the function returns counts as it does for any other.
function ReturnsObject() {
  return { made: "by hand" };
}
function ReturnsNumber() {
  return 7;
}
show("returns an object", construct(ReturnsObject));
show("returns a number", construct(ReturnsNumber));
console.log(construct(ReturnsNumber) instanceof ReturnsNumber, construct(ReturnsObject) instanceof ReturnsObject);

// Another new.target chooses the prototype.
function Target() {}
Target.prototype.from = "target";
const constructFor = new Function("F", "T", "return Reflect.construct(F, [], T)" + nothing);
console.log(
  constructFor(Plain, Target).from,
  constructFor(Plain, Target) instanceof Plain,
  constructFor(Plain, Target) instanceof Target,
);
console.log(constructFor(Plain, Plain).greet(), constructFor(NullObject, Target).from);
class Below extends Plain {
  field = 3;
}
const below = construct(Below);
show("below", below);
console.log(below.greet(), below instanceof Plain, below instanceof Below);

// Called, it makes nothing.
const call = new Function("F", "return F()" + nothing);
console.log(call(Plain), call(NullObject), call(ReturnsNumber));

// Compiled code and the text make the same kind of object.
const here = new NullObject();
here.shop = "east";
here.order = 1;
show("here", here);
console.log(Object.keys(here).join() === Object.keys(createParams([0, 0])).join());
const bound = Plain.bind(null);
console.log(construct(bound) instanceof Plain, construct(bound).greet());
const throws = new Function("F", "try { return new F() } catch (error) { return error.constructor.name }" + nothing);
console.log(
  throws(() => {}),
  typeof throws(Plain),
);
