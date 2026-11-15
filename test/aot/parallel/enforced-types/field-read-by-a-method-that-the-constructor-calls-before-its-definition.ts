// A method that the constructor above calls reads a field of the class below in front of its definition, and one that is defined and not yet stored: absent the first time, undefined the second, a number the third.
// The slot is held to `number`, and the two markers lie in it beside the numbers: a reader that took the written type for all that a filled slot holds would add 1 to a word that is no number.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
const seen: string[] = [];
class Base {
  constructor() {
    this.look("in front of the definition");
  }
  look(when: string) {
    seen.push(when + ": base");
  }
}
class Circle extends Base {
  area: number;
  round: boolean;
  constructor(area: number) {
    super();
    this.look("defined, not stored");
    this.area = area;
    this.round = area > 1;
    this.look("stored");
  }
  look(when: string) {
    seen.push(when + ": " + (this.area + 1) + " " + typeof this.area + " " + (this.round ? "round" : "not round") + " " + ("area" in this));
  }
}
function areaOf(circle: Circle): number {
  return circle.area + 1;
}
console.log(areaOf(new Circle(1)), seen.join(" | "));
for (let turn = 0; turn < 3; turn++) {
  seen.length = 0;
  console.log(turn, areaOf(new Circle(turn)), seen.join(" | "));
}
