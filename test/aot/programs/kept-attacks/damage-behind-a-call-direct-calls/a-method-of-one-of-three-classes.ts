// The receiver of a method call is an instance of one of three classes. The method of one of them damages the object that the caller holds, the other two leave it alone.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
abstract class Visitor {
  abstract visit(p: Point): number;
}
class Reader extends Visitor {
  visit(p: Point): number {
    return p.y;
  }
}
class Writer extends Visitor {
  visit(p: Point): number {
    p.y += 1;
    return p.y;
  }
}
class Breaker extends Visitor {
  visit(p: Point): number {
    delete (p as any).x;
    return -1;
  }
}
const visitors: Visitor[] = [new Reader(), new Writer(), new Breaker()];

function holder(p: Point, visitor: Visitor): string {
  const before = p.x + p.y;
  const got = visitor.visit(p);
  return before + " " + got + " " + p.x + "," + p.y;
}

for (let round = 0; round < 300; round++) {
  const which = round % 100 === 99 ? 2 : round & 1;
  const line = holder(new Point(round, 1), visitors[which]);
  if (round % 100 >= 98 || round === 0) console.log(round + ": " + line);
}
