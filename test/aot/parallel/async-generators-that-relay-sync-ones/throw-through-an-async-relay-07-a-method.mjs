class L {
  *letters() {
    try {
      yield "a";
    } catch (problem) {
      yield "caught " + problem;
    }
  }
  async *relay() {
    yield* this.letters();
  }
}
const stream = new L().relay();
await stream.next();
console.log((await stream.throw("late")).value);
