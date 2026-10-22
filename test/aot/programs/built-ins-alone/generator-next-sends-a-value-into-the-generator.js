function* echo() {
  const sent = yield 1;
  console.log(typeof sent, sent.length);
  const again = yield 2;
  console.log(typeof again, again + 1);
}
const running = echo();
running.next();
running.next("text");
running.next(2.5);
