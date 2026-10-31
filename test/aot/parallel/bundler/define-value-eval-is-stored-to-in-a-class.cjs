// The body of a class is strict code, where a store to `eval` is a SyntaxError whatever the name is bound to: under `bun run` a file does not load where such a store has a name whose `--define` value is `eval`. The build stops at the store.
// Flags: --define RUN=eval
function outer(eval) {
  class Store {
    run() {
      RUN = 1;
      return eval;
    }
  }
  return new Store().run();
}
console.log(outer(2));
/* Build errors:
error: TS100050: --aot does not support --define RUN=eval where RUN is stored to in strict mode. The value is read as a name. A string needs quotes: --define 'RUN="eval"'
*/
