// The key is a constant text that stands nowhere else in the program. Nothing here asks for a promise.
const KEY = "kk";
class Holder {
  [KEY] = 1;
}
const { [KEY]: held } = new Holder();
console.log(held);
