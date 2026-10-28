function make(mapper) {
  return Array.from({ length: 2 }, mapper);
}
const none = make();
const numbers = make((value, index) => index + 1);
const texts = make((value, index) => "s" + index);
console.log(none.map(value => typeof value).join(), numbers.map(value => value * 2).join(), texts.map(value => value.length).join());
console.log(none.concat(numbers, texts).map(value => typeof value).join());
