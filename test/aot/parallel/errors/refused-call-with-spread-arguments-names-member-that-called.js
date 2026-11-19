// The message where what `call` is called on is no function names the member that was called, with spread arguments too.
const notCallable = Object.create(Function.prototype);
function spread(f, list) {
  const result = f.call(null, ...list);
  return [result];
}
try {
  console.log(spread(notCallable, [1, 2]));
} catch (error) {
  console.log(error.name, error.message);
}
