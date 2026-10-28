// A pattern without elements opens an iterator and closes it again. Opening it reads `next`, here behind a getter that nothing else runs.
const said = [];
const [] = {
  [Symbol.iterator]() {
    return {
      get next() {
        said.push("next");
        return () => ({ done: true });
      },
    };
  },
};
console.log(said.join());
