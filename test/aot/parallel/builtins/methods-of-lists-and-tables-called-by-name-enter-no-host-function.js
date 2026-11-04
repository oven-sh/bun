// pop, shift, unshift, splice of a list and clear of a map or a set, called by name on a receiver of which nothing is proven: the stub of the class looks at the receiver and an operation gives the whole answer: the function of the host is not entered.
// The last of a vector of values or int32s is popped in the stub itself: of the 200,000 pops here the operation sees the 100,000 of fractions.
// COUNT: operation:operationAOTArrayPopOfAnyList = 100000
// COUNT: operation:operationAOTArrayShiftOfAnyList >= 100000
// COUNT: operation:operationAOTArrayUnshiftOfAnyList >= 100000
// COUNT: operation:operationAOTArraySpliceOfAnyList >= 100000
// COUNT: operation:operationAOTArraySpliceItemIntoAnyList >= 200000
// COUNT: operation:operationAOTMapClearOfAnyMap >= 50000
// COUNT: operation:operationAOTSetClearOfAnySet >= 50000
const handlers = {
  popped(list) {
    return list.pop() + 1;
  },
  shifted(list) {
    return list.shift() + 1;
  },
  unshifted(list, item) {
    return list.unshift(item) + 1;
  },
  inserted(list, at, item) {
    list.splice(at, 0, item);
    return list.length;
  },
  removed(list, at) {
    return list.splice(at, 1).length;
  },
  cleared(table) {
    table.clear();
    return table.size;
  },
};
const names = Object.keys(handlers);
const list = [1, 2, 3, 4];
const fractions = [0.5, 1.5];
const map = new Map();
const set = new Set();
let sum = 0;
for (let turn = 0; turn < 100000; turn++) {
  sum += handlers[names[3]](list, turn & 3, turn);
  sum += handlers[names[0]](list);
  fractions.push(turn + 0.5);
  sum += handlers[names[0]](fractions);
  sum += handlers[names[2]](list, turn);
  sum += handlers[names[1]](list);
  sum += handlers[names[3]](list, 1, turn);
  sum += handlers[names[4]](list, 2);
  map.set(turn & 7, turn);
  set.add(turn & 7);
  sum += handlers[names[5]](turn & 1 ? map : set);
}
console.log(sum, list.join(), fractions.join(), map.size, set.size);
