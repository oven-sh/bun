// A built-in that makes its result with a constructor it finds through an operand (`constructor`, @@species, `this` of a static method) runs code of the program: each line goes wrong if a read of a counter moves across the call.
let constructed = 0;
class Counted extends Array {
  constructor(...values) {
    super(...values);
    constructed++;
  }
}
function arrayMethods() {
  const list = Counted.from([1, 2, 3]);
  constructed = 0;
  list.map(value => value);
  const afterMap = constructed;
  list.filter(() => true);
  const afterFilter = constructed;
  list.slice(1);
  const afterSlice = constructed;
  list.concat([4]);
  return [afterMap, afterFilter, afterSlice, constructed];
}
function staticMethods() {
  constructed = 0;
  Counted.of(1, 2);
  const afterOf = constructed;
  Array.from.call(Counted, [1]);
  return [afterOf, constructed];
}
let promises = 0;
class CountedPromise extends Promise {
  constructor(executor) {
    super(executor);
    promises++;
  }
}
function promiseMethods() {
  const promise = CountedPromise.resolve(1);
  promises = 0;
  promise.then(() => {});
  const afterThen = promises;
  promise.finally(() => {});
  const afterFinally = promises;
  CountedPromise.all([]);
  return [afterThen, afterFinally > afterThen, promises > afterFinally];
}
let looked = 0;
const withConstructorGetter = Object.defineProperty([1, 2], "constructor", {
  get() {
    looked++;
    return Array;
  },
});
function constructorGetter() {
  looked = 0;
  withConstructorGetter.map(value => value);
  return looked;
}
console.log(arrayMethods(), staticMethods(), promiseMethods(), constructorGetter());
