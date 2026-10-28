// A switch (or a chain of `===` joined by `||`) over a `number` parameter compares integers, not doubles, also where the parameter may be undefined because the function is used as a value too. A chain used as a value leads to one block that yields `true`, so the back end sees one target.
// IR= 1 isSmallRange Boolean boolean=true
// IR= 1 isVowelCode Boolean boolean=true
// SIZE< isDeclarationKind 150
// SIZE< isVowelCode 150
// SIZE< classOfCode 250
// SIZE< isSmallRange 90
const enum Kind { First = 170, Variable = 171, Parameter = 174, Property = 175, Method = 179, Getter = 182, Setter = 183, Class = 190, Interface = 196, Enum = 199, Module = 203, Import = 210, Export = 221, Last = 240 }
function isDeclarationKind(kind: number): boolean {
  switch (kind) {
    case Kind.Variable: case Kind.Parameter: case Kind.Property: case Kind.Method: case Kind.Getter: case Kind.Setter:
    case Kind.Class: case Kind.Interface: case Kind.Enum: case Kind.Module: case Kind.Import: case Kind.Export:
      return true
  }
  return false
}
function isVowelCode(code: number): boolean {
  return code === 97 || code === 101 || code === 105 || code === 111 || code === 117 || code === 65 || code === 69 || code === 73 || code === 79 || code === 85
}
function classOfCode(code: number): string {
  switch (code) {
    case 48: case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57:
      return "digit"
    case 32: case 33: case 34: case 39: case 40: case 41: case 44: case 46: case 58: case 59: case 63:
      return "punctuation"
  }
  return "other"
}
function isSmallRange(n: number): boolean {
  return n === 4 || n === 5 || n === 6 || n === 7 || n === 8
}
function wide(n: number): number {
  switch (n) {
    case -2147483648: case -2147483647: case -2147483646: case -2147483640: return 1
    case 2147483647: case 2147483646: case 2147483645: case 2147483600: return 2
    case 0: case 63: case 64: case 127: case 128: case 1000: case 1001: case 1002: case 1003: case 1062: case 1063: case 1064: return 3
  }
  return 0
}
let declarations = 0, vowels = 0, small = 0, wideSum = 0
const classes: Record<string, number> = { digit: 0, punctuation: 0, other: 0 }
for (let i = -300; i < 1300; i++) {
  if (isDeclarationKind(i)) declarations += i
  if (isVowelCode(i)) vowels += i
  classes[classOfCode(i)]++
  if (isSmallRange(i)) small += i
  wideSum += wide(i) * (i & 7)
}
const edges = [-2147483648, -2147483647, -2147483646, -2147483645, -2147483640, -2147483639, 2147483647, 2147483646, 2147483645, 2147483644, 2147483600, 2147483599, 2147483601, 1.5, -0, NaN, 171.5, 4294967467, Infinity]
console.log(declarations, vowels, small, wideSum, JSON.stringify(classes))
console.log(edges.map(wide).join(), edges.map(isDeclarationKind).join(), edges.map(isSmallRange).join(), edges.map(isVowelCode).join(), edges.map(classOfCode).join())
