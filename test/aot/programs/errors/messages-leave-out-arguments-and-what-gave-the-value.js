// Errors of the engine whose messages quote the source under plain Bun: an executable quotes what was called, or the value and the name of the property, or nothing:
// docs/compiler/compatibility.mdx, "Error messages". Plain Bun prints another output.
function tell(label, run) {
  try {
    run();
    console.log(label + ": no error");
  } catch (error) {
    console.log(label + ": " + error.constructor.name + ": " + error.message);
  }
}
class Holder {
  method(x) {
    return x;
  }
}
const holder = new Holder();
const bound = [holder.method.bind(holder), holder.method.bind(holder), holder.method.bind(holder)];
const size = 60;
const object = { inner: {} };
let empty = null;
let missing;
tell("new with arguments", () => new bound[2](9));
tell("new without arguments", () => new bound[2]());
tell("a call with a constant as its argument", () => empty(size));
tell("a call with two arguments", () => object.absent(1, size));
tell("a call of a number", () => (1)());
tell("a call of what a call returned", () => (() => 5)()());
tell("a name outside ASCII", () => object.中());
tell("a read two members deep", () => object.absent.deeper);
tell("a read of a variable that holds nothing", () => missing.member);
tell("a read under a symbol", () => empty[Symbol.iterator]);
tell("a list pattern", () => {
  const [first] = empty;
});
tell("an object pattern", () => {
  const { first } = empty;
});
tell("instanceof with a literal on the left", () => ({}) instanceof object);
tell("instanceof with names on both sides", () => holder instanceof object);
tell("in", () => "key" in size);
