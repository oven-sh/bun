// In `s.area(between())` the method is looked up before the argument is evaluated. The argument replaces the method on the prototype object, hides it on the object, or changes the prototype. The function that was found first is the one that runs.
class Square {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(extra: number): number {
    return this.side * this.side + extra;
  }
}
const area = Square.prototype.area;

let mode = 0;
function between(s: Square): number {
  if (mode === 1) Square.prototype.area = () => -1;
  else if (mode === 2) (s as any).area = () => -2;
  else if (mode === 3) Object.setPrototypeOf(s, { area: () => -3 });
  else if (mode === 4) delete (Square.prototype as any).area;
  return 1;
}

function holder(s: Square): string {
  const first = s.area(0);
  const second = s.area(between(s));
  let third: string;
  try {
    third = "" + s.area(0);
  } catch (error) {
    third = (error as Error).name;
  }
  return first + " " + second + " " + third;
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Square(round));
  Square.prototype.area = area;
  if (mode || round === 0) console.log(round + ": " + line);
}
