// Its own members are found first, and the map's are below them.
class Mine extends Bun.CookieMap {
  get(name) {
    return `mine:${super.get(name)}`;
  }
}
const mine = new Mine("a=1");
mine.set("b", "2");
console.log(
  `${mine.get("a")} ${mine instanceof Bun.CookieMap} ${[...mine].length} ${Object.getPrototypeOf(mine) === Mine.prototype} ${mine.size}`,
);
console.log(
  `${JSON.stringify(mine)} ${Bun.CookieMap.prototype.get.call(mine, "b")} ${mine.toSetCookieHeaders().length}`,
);
mine.forEach(function (value, key, map) {
  console.log(`${key}=${value} ${map === mine} ${this}`);
}, "receiver");
