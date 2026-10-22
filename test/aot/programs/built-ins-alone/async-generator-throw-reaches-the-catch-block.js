async function* guarded() {
  try {
    yield 1;
  } catch (error) {
    console.log(typeof error, error.code + 1);
  }
}
const running = guarded();
await running.next();
console.log((await running.throw({ code: 1.5 })).done);
