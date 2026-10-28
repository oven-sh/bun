// A pattern without elements takes what may be an array and is an object with an iterator of its own. Opening that iterator reads `next`, here behind a getter that nothing else runs.
const said = [];
const [] =
  process.argv.length > 9
    ? []
    : {
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
