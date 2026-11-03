// An array method borrowed by `.call` for a string that a closure has captured: the callback gets the String object made from it.
const got = [];
{
  const receiver = "abc";
  const run = () => {
    Array.prototype.forEach.call(receiver, function (value, index, all) { got.push(typeof all + ":" + all[index] + ":" + (all instanceof String)); });
  };
  run();
}
console.log(got.join(" "));
