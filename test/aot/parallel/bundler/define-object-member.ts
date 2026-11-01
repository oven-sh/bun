// A read of one member of a `--define` whose value is an object or an array has that member in its place. Any other use has the value.
// Flags: --define OBJ={"A":"x","N":{"B":2,"C":[3]},"L":[1,{"M":4}],"k-k":5,"U":"ü"} --define LIST=[1,[2],3]
// Reference: bun build --compile
declare const OBJ: {
  A: string, N: { B: number, C: number[] }, L: [number, { M: number }], "k-k": number, U: string, missing?: string,
}
declare const LIST: [number, number[], number]
const members = () => [OBJ.A, OBJ["A"], OBJ["A" as const], OBJ.N.B, OBJ.N.C[0], OBJ.L[1].M, OBJ.L.length, OBJ["k-k"], LIST[1][0], LIST[0 as number], LIST.length, (OBJ as any).N!.B, OBJ.U, OBJ.U[0], (OBJ.U + "x").length]
const others = (key: "A") => [OBJ.missing, typeof OBJ.toString, OBJ?.A, OBJ[key], (OBJ as any)["A" + ""], OBJ.L[9 as number], OBJ.L[1 - 1], LIST[-1 as number], (LIST[2 - 1] as number[])[0]]
console.log(JSON.stringify(members()), JSON.stringify(others("A")))
if (OBJ.A === "x" && OBJ.N.B === 2 && LIST[0] === 1) console.log("folded"); else console.log("not reached")
OBJ.N.B = 9
OBJ.L.push(0)
console.log(delete (OBJ as any).A, OBJ.A, OBJ.N.B, OBJ.L.length, OBJ.N === OBJ.N, OBJ.L === OBJ.L)
try { (OBJ.N.B as any)() } catch (error) { console.log(error instanceof TypeError) }
try { (OBJ.A as any).length = 0 } catch (error) { console.log(error instanceof TypeError) }
