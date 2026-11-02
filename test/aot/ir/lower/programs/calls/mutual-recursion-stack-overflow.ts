// RUN: lower
// OPTIONS: builtin-modules

// Recursion that never ends has to end in a RangeError that can be caught, whichever functions of the ring are small or large, and however the ring is closed.
interface Node { kind: number; next: Node | undefined; value: number }
let entered = 0
function attempt(name: string, run: () => number) {
  entered = 0
  let outcome: string
  try { outcome = "returned " + run() } catch (error) { outcome = error instanceof RangeError ? "RangeError" : "another error: " + error }
  console.log(name + ": " + outcome + ", went deep: " + (entered > 1000))
}
function itself(n: number): number { entered++; return itself(n + 1) + 1 }
function first(n: number): number { entered++; return second(n + 1) + 1 }
function second(n: number): number { return first(n + 1) + 1 }
function small(n: number): number { return middle(n + 1) + 1 }
function middle(n: number): number { entered++; return n & 1 ? large(n, n + 1, n + 2) + 1 : large(n + 2, n + 1, n) + 2 }
function large(a: number, b: number, c: number): number {
  let sum = 0
  for (let i = 0; i < 3; i++) sum += (a * i) ^ (b + i) ^ (c - i)
  const x = a + b, y = b + c, z = a + c
  if (sum === -1) return x * y * z
  const below = small(a + 1)
  return below + x + y + z + sum
}
function viaTwoWays(n: number): number { entered++; return n % 3 ? wayOne(n + 1) : wayTwo(n + 1) }
function wayOne(n: number): number { return viaTwoWays(n + 1) + 1 }
function wayTwo(n: number): number { return wayThree(n + 1) + 1 }
function wayThree(n: number): number { return viaTwoWays(n + 1) + wayOne(n + 2) }
class Walker {
  depth = 0
  enter(node: Node): number { entered++; this.depth++; return this.visit(node) + 1 }
  visit(node: Node): number { return node.next ? this.enter(node.next) : 0 }
}
function throughCallback(n: number, again: (n: number) => number): number { entered++; return again(n + 1) + 1 }
function callback(n: number): number { return throughCallback(n, callback) }
function throughArray(n: number): number { entered++; return [n].map(x => throughArray(x + 1))[0] + 1 }
function chain01(n: number): number { return chain02(n) + 1 } function chain02(n: number): number { return chain03(n) + 1 }
function chain03(n: number): number { return chain04(n) + 1 } function chain04(n: number): number { return chain05(n) + 1 }
function chain05(n: number): number { return chain06(n) + 1 } function chain06(n: number): number { return chain07(n) + 1 }
function chain07(n: number): number { return chain08(n) + 1 } function chain08(n: number): number { return chain09(n) + 1 }
function chain09(n: number): number { return chain10(n) + 1 } function chain10(n: number): number { return chain11(n) + 1 }
function chain11(n: number): number { return chain12(n) + 1 } function chain12(n: number): number { return chain13(n) + 1 }
function chain13(n: number): number { return chain14(n) + 1 } function chain14(n: number): number { return chain15(n) + 1 }
function chain15(n: number): number { return chain16(n) + 1 } function chain16(n: number): number { return chain17(n) + 1 }
function chain17(n: number): number { return chain18(n) + 1 } function chain18(n: number): number { return chain19(n) + 1 }
function chain19(n: number): number { return chain20(n) + 1 } function chain20(n: number): number { entered++; return n > 0 ? chain01(n + 1) + JSON.stringify({ n }).length : 0 }
const ring: Node = { kind: 1, next: undefined, value: 1 }
ring.next = { kind: 2, next: ring, value: 2 }
attempt("a function that calls itself", () => itself(0))
attempt("two functions", () => first(0))
attempt("entered at the other one", () => second(0))
attempt("small, middle, large", () => small(0))
attempt("entered at the large one", () => large(1, 2, 3))
attempt("entered at the middle one", () => middle(1))
attempt("rings that share functions", () => viaTwoWays(0))
attempt("entered on a way", () => wayThree(0))
attempt("methods", () => new Walker().enter(ring))
attempt("a callback", () => callback(0))
attempt("a built-in function between", () => throughArray(0))
attempt("a ring of twenty", () => chain01(1))
attempt("the twenty once", () => chain01(0))
function recovers(n: number): number {
  try { return recovers(n + 1) + 1 } catch (error) { if (!(error instanceof RangeError)) throw error; return chain01(0) }
}
console.log("caught at the bottom, and goes on from there: " + (recovers(0) > 1000))
let rounds = 0
for (let i = 0; i < 20; i++) { try { small(i) } catch { rounds++ } }
console.log("again and again: " + rounds)
async function later(n: number): Promise<number> { await null; try { return first(n) } catch (error) { return error instanceof RangeError ? -1 : -2 } }
console.log("behind an await: " + await later(0))
function* yields(n: number): Generator<number> { try { yield small(n) } catch (error) { yield error instanceof RangeError ? -1 : -2 } }
console.log("in a generator: " + [...yields(0)])

// GENERATED: chain20 later Walker
// CHECK-LABEL: function {{*}}name="chain20"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="entered"
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="entered"
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_3]]
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Greater v0, v8
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v10, v12
// CHECK-NEXT: v14 = Call v11, -, v13 calleeName="chain01"
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v16 = Builtin builtin=JSON
// CHECK-NEXT: v17 = PropGet v16 key="stringify"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v19 = Convert v10 declared={type=number}
// CHECK-NEXT: v20 = NewObject -, v19 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v21 = FinishObject v20
// CHECK-NEXT: v22 = Call v18, v16, v21 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = PropGet v23 key="length"
// CHECK-NEXT: v25 = Add v15, v24
// CHECK-NEXT: Jump -> next b6(v25)
// CHECK-NEXT: b4(v26):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v27 = Integer
// CHECK-NEXT: Jump -> next b6(v27)
// CHECK-NEXT: b6(v28):
// CHECK-NEXT: v29 = Convert v28 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_9]]}] results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Null
// CHECK-NEXT: v3 = Await v2, v1
// CHECK-NEXT: v4 = Convert v3 declared={type=null site=[[w_10]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v6 = Call v5, -, v1 calleeName="first"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v8 = Convert v7 declared={type=number|object site=[[w_13]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="RangeError" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v13 = InstanceOf v9, v12 writtenExpression="error instanceof RangeError"
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v16 = Integer integer=-1
// CHECK-NEXT: Jump -> next b8(v16)
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v18 = Integer integer=-2
// CHECK-NEXT: Jump -> next b8(v18)
// CHECK-NEXT: b8(v19):
// CHECK-NEXT: v20 = Convert v19 declared={type=number|object site=[[w_13]]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Walker"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_14]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_15]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
