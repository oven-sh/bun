// The word comes from outside and passes a label that spells it: the label is a text that the program writes, as the text beside `===` is.
let held;
[0].forEach(function () {
  held = this;
});
function call(holder, word, text) {
  switch (word) {
    case "require":
    case "eval":
      return holder[word](text);
    default:
      return "no such word";
  }
}
console.log(call(held, JSON.parse('"eval"'), JSON.parse('"6 * 7"')));
