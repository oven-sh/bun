// Methods of a class replaced and added after instances were made and called
class Greeter {
  constructor(name) {
    this.name = name;
  }
  greet() {
    return "hi " + this.name;
  }
}
class Loud extends Greeter {
  greet() {
    return super.greet() + "!";
  }
}
const original = Greeter.prototype.greet;
function run(name) {
  const list = [new Greeter(name), new Loud(name)];
  const out = [list.map(one => one.greet()).join()];
  Greeter.prototype.greet = function () {
    return "hey " + this.name;
  };
  out.push(list.map(one => one.greet()).join());
  list[0].greet = () => "own";
  out.push(list.map(one => one.greet()).join());
  Greeter.prototype.greet = original;
  return out.join(" | ");
}
console.log(run("a"));
console.log(run("bob"));
console.log(run(""));
