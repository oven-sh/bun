// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 6
// CHECK-LABEL: function {{*}}name="Square"
// CHECK-LABEL: function {{*}}name="Cube"
// CHECK-LABEL: function {{*}}name="volume"
// CHECK-LABEL: function {{*}}name="norm"

// FILE: main.ts
// A class named as a member of a namespace is the class the member is bound to: it has a layout, and so have the classes that extend it.
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

// FILE: early.ts
import * as Late from './late'
export function tooEarly(): string {
  try {
    class Hasty extends Late.Root {}
    return 'made ' + new Hasty().value
  } catch (e) {
    return e instanceof ReferenceError ? 'ReferenceError' : 'other ' + e
  }
}
export const seen = tooEarly()

// FILE: late.ts
import { seen } from './early'
export class Root {
  value = 7
}
export class Derived extends Root {}
export const early = () => seen

// FILE: nested.ts
export * as Nested from './reexports'

// FILE: reexports.ts
export * as Shapes from './shapes'

// FILE: shapes.ts
export interface HasArea {
  area(): number
}
export class Base {
  static made = 0
  static tally(): string {
    return 'made ' + Base.made
  }
  name: string
  constructor(name: string) {
    this.name = name
    Base.made++
  }
  describe(): string {
    return 'a ' + this.name
  }
}
export const Held = class {
  kept = 1
}
export let Replaced: new () => object = class {
  first = 1
}
Replaced = class {
  second = 2
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
