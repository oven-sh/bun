// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 6

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

// GENERATED: Square Cube volume norm
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_2]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|string, v3: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v0
// CHECK-NEXT: v6 = SuperConstruct v5, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_5]]
// CHECK-NEXT: v11 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12) frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = Convert v3 declared={type=number site=[[w_6]]}
// CHECK-NEXT: PropSet v14, v15 key="side"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v18 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: Jump -> next b10(v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = TypeTest v20 testedType=undefined
// CHECK-NEXT: Branch v21 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v23 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v24) frequency=Unlikely:
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v25
// CHECK-NEXT: b9(v26):
// CHECK-NEXT: Jump -> next b10(v26)
// CHECK-NEXT: b10(v27):
// CHECK-NEXT: Return v27
// CHECK-NEXT: b11(v28) frequency=Unlikely:
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=DerivedConstructorResult name="Square"
// CHECK-NEXT: Throw v29
// CHECK-NEXT: b12(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Cube"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="volume"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_8]] site=[[w_10]]} results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="edge"
// CHECK-NEXT: v2 = Integer integer=3
// CHECK-NEXT: v3 = Pow v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="norm"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_12]] site=[[w_13]]} results=[{type=number site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: [[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathAbs
// CHECK-NEXT: v3 = PropGet v0 key="x"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeName="Math.abs"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Builtin builtin=Math
// CHECK-NEXT: v7 = Builtin builtin=MathAbs
// CHECK-NEXT: v8 = PropGet v0 key="y"
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeName="Math.abs"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_16]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Add v5, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_14]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
