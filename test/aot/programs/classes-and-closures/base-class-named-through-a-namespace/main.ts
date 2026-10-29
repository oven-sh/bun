// A class named as a member of a namespace is the class the member is bound to: it has a layout, and so have the classes that extend it.
// IR+ ^layout L[0-9]+ .*\{name="side" declared=
// IR+ ^layout L[0-9]+ .*\{name="edge" declared=
// IR+ ^layout L[0-9]+ .*\{name="extra" declared=
// IR- ^layout L[0-9]+ .*\{name="unplaced" declared=
import * as Shapes from './shapes'
import { Nested } from './nested'
import * as Late from './late'
import { tooEarly } from './early'

class Square extends Shapes.Base implements Shapes.HasArea {
  side: number
  constructor(name: string, side: number) {
    super(name)
    this.side = side
  }
  area(): number {
    return this.side * this.side
  }
  override describe(): string {
    return super.describe() + ' of side ' + this.side
  }
}

class Cube extends Nested.Shapes.Base {
  edge = 3
  volume(): number {
    return this.edge ** 3
  }
}

namespace Local {
  export class Point {
    constructor(public x: number, public y: number) {}
    norm(): number {
      return Math.abs(this.x) + Math.abs(this.y)
    }
  }
  export namespace Deeper {
    export class Origin extends Point {
      constructor() {
        super(0, 0)
      }
    }
  }
}

class Labeled extends Local.Point {
  label = 'p'
}

class FromConst extends Shapes.Held {
  extra = 2
}

class FromVariable extends Shapes.Replaced {
  unplaced = 4
}

function area(square: Square): number {
  return square.side * square.side
}
function describe(square: Square): string {
  return square.name + ':' + square.side
}
function total(cube: Cube, labeled: Labeled, held: FromConst): number {
  return cube.edge + labeled.x + labeled.y + held.kept + held.extra
}

const square = new Square('square', 4)
const base = new Shapes.Base('plain')
const cube = new Cube('cube')
const labeled = new Labeled(5, -6)
const origin = new Local.Deeper.Origin()
const held = new FromConst()
const replaced = new FromVariable()
console.log(square.area(), area(square), describe(square), square.describe(), base.describe(), cube.describe(), cube.volume())
console.log(square instanceof Shapes.Base, square instanceof Square, cube instanceof Shapes.Base, base instanceof Square, Object.getPrototypeOf(Square) === Shapes.Base)
console.log(labeled.norm(), labeled.label, origin.norm(), origin instanceof Local.Point, total(cube, labeled, held))
console.log(Shapes.Base.made, Nested.Shapes.Base.made, Shapes.Base.tally(), Object.keys(square).join(), JSON.stringify(square), JSON.stringify(cube))
console.log(replaced.unplaced, (replaced as { second?: number }).second, (replaced as { first?: number }).first, replaced instanceof Shapes.Replaced)
console.log(tooEarly(), Late.early(), new Late.Derived().value)
