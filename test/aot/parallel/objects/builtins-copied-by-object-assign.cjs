const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));
function who() {
  return this;
}
const quiet = Object.assign({}, console, { log() { return "quiet"; } });
const numbers = Object.assign({}, Math, { max: () => -1 });
const spread = { ...JSON, stringify: () => "text" };
tell(quiet.log("x"), typeof quiet.warn, quiet.warn === console.warn, Object.hasOwn(quiet, "error"), Object.keys(numbers).join());
tell(spread.stringify({}), typeof spread.parse, JSON.stringify([1]), Math.max(1, 2));

const Lib = {};
(function (lib) {
  lib.number = function (value) {
    return Math.abs(parseInt(value));
  };
  lib.Point = function Point(x) {
    this.x = x;
    this.next = null;
  };
  lib.Point.prototype.toString = function () {
    return "-" + this.x + "px";
  };
  lib.Point.prototype.move = function (by) {
    this.x += lib.number(by);
    return this;
  };
})(Lib);
const run = count => {
  const point = new Lib.Point(0.5);
  for (let i = 0; i < count; i++) point.move(i % 7 ? i : point);
  return point.x;
};
tell(run(10), run(300));

const both = [who(), who.call(Math), who.call(quiet)];
tell(typeof both[0], both[1] === Math, both[2] === quiet);
const relinked = Object.assign({}, JSON.parse('{"__proto__": {"deep": 3}, "own": 1}'));
tell(relinked.deep, relinked.own, Object.getPrototypeOf(relinked) === Object.prototype);
const stored = [];
const watched = Object.assign({ set a(value) { stored.push(value); } }, { a: 5, b: 6 });
tell(stored.join(), watched.b, Object.keys(watched).join());

const name = ["parse", "Int"].join("");
both[0][name] = () => 7;
tell(parseInt("12"), run(3), new Lib.Point(1).move("3").x);
Object.assign(globalThis, { parseInt: text => text.length });
tell(parseInt("12345"), new Lib.Point(1).move("345").x);
console.log(lines.join("\n"));
