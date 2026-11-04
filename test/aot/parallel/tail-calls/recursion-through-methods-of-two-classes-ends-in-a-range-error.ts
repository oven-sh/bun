// two small methods of one name, of two classes, call each other by the name without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
interface Visited {
  visit(): number;
}
class Left implements Visited {
  other: Visited | null = null;
  visit(): number {
    turns++;
    return this.other!.visit() + 1;
  }
}
class Right implements Visited {
  other: Visited | null = null;
  visit(): number {
    turns++;
    return this.other!.visit() + 2;
  }
}
class End implements Visited {
  visit(): number {
    return 0;
  }
}
const left = new Left();
const right = new Right();
left.other = right;
right.other = left;
function deed(first: Visited) {
  turns = 0;
  try {
    return String(first.visit());
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed(left));
for (let i = 0; i < 3; i++) console.log(deed(i & 1 ? left : right));
right.other = new End();
console.log(deed(left));
