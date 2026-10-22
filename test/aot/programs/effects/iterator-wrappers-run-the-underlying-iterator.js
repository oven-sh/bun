// `next` and `return` of what Iterator.from() and the iterator helpers make call `next` and `return` of the underlying iterator, which is code of the program: each line goes wrong if a read of a counter moves across the call.
let wrappedNext = 0;
let wrappedReturn = 0;
const wrapped = {
  next() {
    wrappedNext++;
    return { done: false, value: wrappedNext };
  },
  return() {
    wrappedReturn = 1;
    return {};
  },
};
function stepWrapper() {
  const wrapper = Iterator.from(wrapped);
  wrappedNext = 0;
  wrapper.next();
  const afterOne = wrappedNext;
  wrapper.next();
  return [afterOne, wrappedNext];
}
function closeWrapper() {
  const wrapper = Iterator.from(wrapped);
  wrappedReturn = 0;
  wrapper.return();
  return wrappedReturn;
}
console.log("wrapper", stepWrapper(), closeWrapper());

let helperNext = 0;
let helperReturn = 0;
let mapped = 0;
class Source extends Iterator {
  next() {
    helperNext++;
    return { done: false, value: helperNext };
  }
  return() {
    helperReturn++;
    return {};
  }
}
function stepHelper() {
  const helper = new Source().map(value => {
    mapped = value;
    return value * 2;
  });
  helperNext = 0;
  mapped = 0;
  const first = helper.next().value;
  return [first, helperNext, mapped];
}
function closeFreshHelper() {
  const helper = new Source().filter(value => value > 1);
  helperReturn = 0;
  helper.return();
  return helperReturn;
}
function closeRunningHelper() {
  const helper = new Source().drop(1);
  helper.next();
  helperReturn = 0;
  helper.return();
  const afterFirst = helperReturn;
  helper.return();
  return [afterFirst, helperReturn];
}
function exhaustTake() {
  const helper = new Source().take(1);
  helper.next();
  helperReturn = 0;
  const last = helper.next().done;
  return [last, helperReturn];
}
console.log("helper", stepHelper(), closeFreshHelper(), closeRunningHelper(), exhaustTake());
