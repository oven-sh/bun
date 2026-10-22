async function* echo() {
  const sent = yield 1;
  console.log(typeof sent, sent.length);
}
const running = echo();
console.log((await running.next()).value + 1);
console.log((await running.next("text")).done);
