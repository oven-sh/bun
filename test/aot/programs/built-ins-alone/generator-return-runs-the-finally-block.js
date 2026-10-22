let state = "open";
function* guarded() {
  try {
    yield 1;
  } finally {
    state = 0.5;
  }
}
const running = guarded();
running.next();
const answer = running.return("text");
console.log(answer.done, answer.value.length, typeof state, state + 1);
