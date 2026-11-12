// Its own members are found first, and the form's are below them.
class Mine extends FormData {
  get(name) {
    return `mine:${super.get(name)}`;
  }
}
const mine = new Mine();
mine.append("a", "1");
console.log(
  `${mine.get("a")} ${mine instanceof FormData} ${[...mine].length} ${Object.getPrototypeOf(mine) === Mine.prototype} ${mine.length}`,
);
console.log(`${mine.getAll("a")} ${JSON.stringify(mine)} ${FormData.prototype.get.call(mine, "a")}`);
mine.forEach(function (value, key, form) {
  console.log(`${key}=${value} ${form === mine} ${this}`);
}, "receiver");
