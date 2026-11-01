// Errors of the engine whose messages quote the source under plain Bun: an executable quotes the text of the function where it says which place failed, or else what was called, or the value and the name of the property, or nothing:
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
/* Output:
new with arguments: TypeError: function is not a constructor (evaluating 'new bound[2](9)')
new without arguments: TypeError: function is not a constructor (evaluating 'new bound[2]')
a call with a constant as its argument: TypeError: empty is not a function. (In 'empty(size)', 'empty' is null)
a call with two arguments: TypeError: object.absent is not a function. (In 'object.absent(1, size)', 'object.absent' is undefined)
a call of a number: TypeError: 1 is not a function
a call of what a call returned: TypeError: 5 is not a function
a name outside ASCII: TypeError: object.\u{4e2d} is not a function. (In 'object.\u{4e2d}()', 'object.\u{4e2d}' is undefined)
a read two members deep: TypeError: undefined is not an object (evaluating 'object.absent.deeper')
a read of a variable that holds nothing: TypeError: undefined is not an object (evaluating 'missing.member')
a read under a symbol: TypeError: null is not an object (evaluating 'empty[Symbol.iterator]')
a list pattern: TypeError: null is not an object (evaluating '[first]')
an object pattern: TypeError: Cannot destructure property 'first' from null or undefined value
instanceof with a literal on the left: TypeError: object is not a function. (evaluating '{} instanceof object')
instanceof with names on both sides: TypeError: object is not a function. (evaluating 'holder instanceof object')
in: TypeError: size is not an Object. (evaluating '"key" in size')
*/
