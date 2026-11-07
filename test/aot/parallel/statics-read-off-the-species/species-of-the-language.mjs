const Maker = Array[Symbol.species];
console.log(
  Maker.from("hi").length,
  Promise[Symbol.species].resolve(1) instanceof Promise,
  Map[Symbol.species].groupBy([1], n => n).size,
);
