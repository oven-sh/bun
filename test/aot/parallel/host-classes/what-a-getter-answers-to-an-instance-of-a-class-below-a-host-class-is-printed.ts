// The getters of a host class answer to an instance of a class of the program below it too.
// Alone: what an executable leaves out goes by all that it holds
class Mine extends AbortController {
  more = 1;
}
const mine = new Mine();
mine.abort(new URL("http://a/b"));
console.log(mine);

export {};
