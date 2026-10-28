// Function expressions named `await` or `yield` inside an async function, a generator and a static block call themselves by those names.
async function waits() {
  return (function await(count) {
    return count === 0 ? "done" : await(count - 1);
  })(3);
}
waits().then(console.log);

function* yields() {
  yield (function yield(count) {
    return count === 0 ? "done" : yield(count - 1);
  })(3);
}
console.log(yields().next().value);

class Holder {
  static {
    console.log(
      (function await(await) {
        return await;
      })(2),
    );
  }
}

async function* both() {
  yield (function await() {
    return (function yield() {
      return typeof await + " " + typeof yield;
    })();
  })();
}
both()
  .next()
  .then(step => console.log(step.value, typeof Holder));
