// The holder has an object whose optional fields are all absent, and has read them. The callee pours another object of the same type into it with Object.assign. In some rounds that other object
// was damaged long before: one of its fields holds a string, and it has a property that the type does not declare. However the run time copies, by name, by a plan that it has made for the two layouts
// or word by word, the target is damaged behind the call as the source was in front of it.
type Loose = { left?: number; right?: number };

const whole: Loose = { left: 1, right: 2 };
const damaged: Loose = { left: 1, right: 2 };
(damaged as any).left = "outside";
(damaged as any).more = 3;
// Whatever is stored here lies in the heap and not in the frame of the function that made it.
let last: Loose = whole;

function pour(target: Loose, source: Loose): number {
  Object.assign(target, source);
  return 1;
}

function holder(target: Loose, source: Loose): string {
  const before = target.left + "," + target.right;
  const got = pour(target, source);
  return before + " " + got + " " + target.left + "," + target.right + "," + typeof target.left;
}

function outer(round: number): string {
  const target: Loose = {};
  last = target;
  const before = "" + target.left + target.right;
  const inner = holder(target, round % 100 === 99 ? damaged : whole);
  return before + " [" + inner + "] " + target.left + "," + target.right + "," + Object.keys(target).join("");
}

for (let round = 0; round < 300; round++) {
  const line = outer(round);
  if (round % 100 >= 98 || round === 0) console.log(round + ": " + line + " " + last.left);
}
