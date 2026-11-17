// The word comes from outside and passes a test against the keys of a record: the record is asked under a key that the program does not write.
let held;
[0].forEach(function () {
  held = this;
});
function call(holder, word, text) {
  if (word in { require: 1, eval: 1 }) return holder[word](text);
  return "no such word";
}
function callOwn(holder, word, text) {
  if (Object.hasOwn({ require: 1, eval: 1 }, word)) return holder[word](text);
  return "no such word";
}
console.log(call(held, JSON.parse('"eval"'), JSON.parse('"6 * 7"')), callOwn(held, JSON.parse('"eval"'), JSON.parse('"6 * 6"')));
