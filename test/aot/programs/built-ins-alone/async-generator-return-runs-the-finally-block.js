let state = "open";
async function* guarded() {
  try {
    yield 1;
  } finally {
    state = 0.5;
  }
}
const running = guarded();
await running.next();
const answer = await running.return("text");
console.log(answer.done, answer.value.length, typeof state, state + 1);
