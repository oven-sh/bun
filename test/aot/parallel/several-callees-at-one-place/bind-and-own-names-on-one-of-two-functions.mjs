// A call by name on one of two functions under names other than call and apply: bind, toString, a name that the program laid on one of them, and call itself laid anew on one of them.
function first(value) {
  return [this === undefined ? "none" : this.tag, value];
}
function second(value) {
  return [this === undefined ? "none" : this.tag, -value];
}
first.describe = function () {
  return "first is " + this.name;
};
second.call = function (receiver, value) {
  return ["own call", receiver.tag, value];
};
const receiver = { tag: "receiver" };
for (let turn = 0; turn < 4; turn++) {
  const chosen = turn % 2 ? first : second;
  console.log(JSON.stringify(chosen.call(receiver, turn)), JSON.stringify(chosen.apply(receiver, [turn])), JSON.stringify(chosen.bind(receiver)(turn)));
  console.log(typeof chosen.toString(), typeof chosen.describe === "function" ? chosen.describe() : "no describe");
  try {
    console.log(chosen.describe());
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
