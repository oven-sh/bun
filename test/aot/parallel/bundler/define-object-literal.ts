// A `--define` whose value is an object literal.
// Flags: --define OBJ={"A":"x","N":{"B":2},"L":[1,2],"U":"ü😀\n"}
// Reference: bun build --compile
declare const OBJ: { A: string, N: { B: number }, L: number[], U: string, missing?: string }
console.log(OBJ.A, OBJ.N.B, OBJ.L.length, OBJ.L[1], OBJ.U, OBJ.missing, typeof OBJ.toString)
console.log(JSON.stringify(OBJ), OBJ === OBJ, OBJ.N === OBJ.N)
if (OBJ.A === "x") console.log("folded"); else console.log("not reached")
const copy = OBJ
;(copy as any).A = "changed"
console.log(copy.A, OBJ.A)
