function* guarded() {
  try {
    yield 1;
  } catch (error) {
    console.log(typeof error, error.code + 1);
    yield "caught";
  }
}
const running = guarded();
running.next();
console.log(running.throw({ code: 1.5 }).value.length);
