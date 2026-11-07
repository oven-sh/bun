// The members of this enumeration have texts of their own: the name "eval" is a key of its object and nothing else.
enum Word {
  eval = "e",
  require = "r",
}
let held: any;
[0].forEach(function (this: any) {
  held = this;
});
function call(holder: any, word: string, text: string): unknown {
  if (word in Word) return holder[word](text);
  return "no such word";
}
console.log(call(held, JSON.parse('"eval"'), JSON.parse('"6 * 7"')));
