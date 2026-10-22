function* three() {
  yield 1.5;
  yield "two";
  return { three: 3 };
}
const running = three();
console.log(running.next().value + 1, running.next().value.length);
const last = running.next();
console.log(last.done, last.value.three + 1, running.next().value === undefined);
