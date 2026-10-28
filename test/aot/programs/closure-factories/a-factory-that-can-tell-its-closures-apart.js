// A factory that names itself is one function, and a template has one array, however often the factory runs. A class or a symbol is made anew by each run.
const named = function factory() {
  return () => factory;
};
console.log(named()() === named, named()() === named()());

const tag = strings => strings;
const template = () => () => tag`a${1}b`;
const one = template();
const other = template();
console.log(one() === one(), one() === other(), Object.isFrozen(one()));

const classes = () => {
  class Point {}
  return () => Point;
};
const pointA = classes();
const pointB = classes();
console.log(pointA() === pointA(), pointA() === pointB(), new (pointA())() instanceof pointB());

const symbols = () => {
  const key = Symbol("key");
  return () => key;
};
const keyA = symbols();
const keyB = symbols();
console.log(keyA() === keyA(), keyA() === keyB(), { [keyA()]: 1 }[keyB()]);
