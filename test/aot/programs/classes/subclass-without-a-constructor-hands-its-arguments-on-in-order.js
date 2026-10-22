// The constructor that the language gives a subclass is `constructor(...args) { super(...args) }`. Each argument reaches the parameter of its position: fewer arguments than parameters, more than
// the parent names, more than eight, a chain of such subclasses, and a parent with a rest parameter of its own.
class Body {
  constructor(name, position, speed) {
    this.name = name;
    this.position = position;
    this.speed = speed;
    this.count = arguments.length;
  }
  describe() {
    return this.name + ":" + this.position.x + "," + (this.speed === undefined ? "still" : this.speed.x) + "/" + this.count;
  }
}
class Ghost extends Body {
  seen = false;
}
class Shade extends Ghost {}
const at = x => ({ x });
console.log(new Ghost("g", at(1), at(2)).describe(), new Shade("s", at(3), at(4)).describe(), new Ghost("short", at(5)).describe(), new Shade("long", at(6), at(7), 8, 9).describe());

class Wide {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    this.text = [a, b, c, d, e, f, g, h, i, j].join("");
    this.last = j;
  }
}
class Wider extends Wide {}
console.log(new Wider(1, 2, 3, 4, 5, 6, 7, 8, "nine", at(10)).text.length, new Wider(1, 2, 3, 4, 5, 6, 7, 8, 9, at(10)).last.x);

class Gathers {
  constructor(first, ...others) {
    this.first = first;
    this.others = others;
  }
}
class GathersToo extends Gathers {}
const gathered = new GathersToo(at(1), "two", 3);
console.log(gathered.first.x, gathered.others.join(), gathered.others.length);

