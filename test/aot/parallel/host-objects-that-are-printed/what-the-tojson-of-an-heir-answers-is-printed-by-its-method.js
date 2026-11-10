// Whoever prints one of these prints what its toJSON() answers and calls that answer's own method, the printer of errors too.
// Exit code: 1
class Mine extends URLSearchParams {
  toJSON() {
    return new URL("http://made.up/");
  }
}
console.log("before");
throw new Mine("made=up");
