function drainNumbers(turns) {
  const stack = [0.5];
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    stack.push(i + 0.5, i + 1.5);
    sum += stack.pop() + stack.pop();
  }
  return sum + stack.length;
}
function drainObjects(turns) {
  const stack = [{ at: 0 }];
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    stack.push({ at: i }, { at: i + 1 });
    sum += stack.pop().at + stack.pop().at;
  }
  return sum + stack.length;
}
function drainFromTheFront(turns) {
  const queue = [{ at: 0 }];
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    queue.push({ at: i });
    sum += queue.shift().at;
  }
  return sum + queue.length;
}
class Walk {
  stack = [1.5];
  step(at) {
    this.stack.push(at + 0.25);
    return this.stack.pop();
  }
}
function walk(turns) {
  const walk = new Walk();
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += walk.step(i);
  return sum;
}
function popWhatever(list) {
  return list.pop();
}
function ofEveryKind() {
  const seen = [];
  for (const list of [[1, 2], [1.5, 2.5], ["a", "b"], [{}, 3], [1, , 3], [, ,], [], JSON.parse("[1,2,3]"), JSON.parse("[1.5,2]"), new Array(3), Array.from({ length: 2 }, (_, k) => k)]) {
    seen.push(String(popWhatever(list)) + ":" + list.length);
  }
  return seen.join();
}
function numbersThatArriveAsIntegers() {
  const list = JSON.parse("[1,2,3,4]");
  let sum = 0.5;
  while (list.length) sum += list.pop();
  list.push(1.5);
  return sum + list.pop();
}
console.log(drainNumbers(2000), drainObjects(2000), drainFromTheFront(2000), walk(2000));
console.log(ofEveryKind());
console.log(numbersThatArriveAsIntegers());
