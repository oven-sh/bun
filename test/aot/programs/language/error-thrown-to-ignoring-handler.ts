// CALLS- ignoresInOneFunction operationAOTNewError
// CALLS- ignoresWhatACalleeThrows operationAOTNewError
// CALLS- ignoresABoundName operationAOTNewError
// CALLS+ readsTheMessage operationAOTNewError
// CALLS+ passesItOn operationAOTNewError
// CALLS+ keepsIt operationAOTNewError
// An error that is made, thrown and caught in one function by a handler that never looks at it is not made. Whatever making it can be seen to do still happens.
// `messageIsAnObject` and `messageThrows` cast an object to `string`: a cast refuses no object, so the error is made of it and `toString` is called.
declare const console: { log(...args: unknown[]): void }
const seen: string[] = []
function ignoresInOneFunction(x: number): number { try { if (x < 5) throw new Error("too small"); return x } catch { return -1 } }
function check(x: number): number { if (x < 5) throw new RangeError("too small: " + x); return x }
function ignoresWhatACalleeThrows(x: number): number { try { return check(x) } catch { return -2 } }
function ignoresABoundName(x: number): number { let t = 0; try { if (x < 5) throw new TypeError(); t = x } catch (e) { t = -3 } return t }
function readsTheMessage(x: number): string { try { if (x < 5) throw new Error("read " + x); return "none" } catch (e) { return (e as Error).message } }
function passesItOn(x: number): number { try { if (x < 5) throw new Error("passed on"); return x } finally { seen.push("finally " + x) } }
let kept: unknown
function keepsIt(x: number): number { try { const made = new Error("kept"); kept = made; if (x < 5) throw made; return x } catch { return -4 } }
function messageIsAnObject(x: number): number { try { if (x < 5) throw new Error({ toString() { seen.push("toString"); return "m" } } as unknown as string); return x } catch { return -5 } }
function messageThrows(x: number): number { try { if (x < 5) throw new Error({ toString() { throw new SyntaxError("from toString") } } as unknown as string); return x } catch { return -6 } }
function causeIsAGetter(x: number): number { try { if (x < 5) throw new Error("m", { get cause() { seen.push("cause"); return 1 } }); return x } catch { return -7 } }
class Counted extends Error { static made = 0; constructor(message: string) { super(message); Counted.made++ } }
function ofASubclass(x: number): number { try { if (x < 5) throw new Counted("counted"); return x } catch { return -8 } }
function nested(x: number): string { try { try { if (x < 5) throw new Error("inner"); return "none" } catch { throw new Error("outer " + x) } } catch (e) { return (e as Error).message } }
function messageMayBeUndefined(x: number, message?: string): number { try { if (x < 5) throw new Error(message); return x } catch { return -9 } }
function twoHandlers(x: number): string { let first = "none"; try { if (x < 5) throw new Error("same") } catch { first = "ignored" } try { if (x < 5) throw new Error("same"); return first } catch (e) { return first + " " + (e as Error).message } }
function inALoop(values: number[]): number { let t = 0; for (let i = 0; i < values.length; i++) { try { t += check(values[i]) } catch (e) { t += 1 } } return t }
for (const x of [1, 9]) {
  console.log(x, ignoresInOneFunction(x), ignoresWhatACalleeThrows(x), ignoresABoundName(x), readsTheMessage(x), keepsIt(x), (kept as Error).message, messageIsAnObject(x), messageThrows(x), causeIsAGetter(x), ofASubclass(x), Counted.made, nested(x))
  try { console.log(passesItOn(x)) } catch (e) { console.log("caught outside:", (e as Error).message, typeof (e as Error).stack) }
}
console.log(inALoop([1, 2, 3, 10, 20, 4]), seen.join(" | "))
console.log(messageMayBeUndefined(1), messageMayBeUndefined(1, "given"), messageMayBeUndefined(9), twoHandlers(1), twoHandlers(9))
const asValues: ((x: number) => number)[] = [ignoresInOneFunction, ignoresWhatACalleeThrows, ignoresABoundName, keepsIt, passesItOn]
for (const each of asValues) console.log(each(7), each === passesItOn ? "" : each(2))
const prepared: string[] = []
;(Error as unknown as { prepareStackTrace: unknown }).prepareStackTrace = (error: Error) => { prepared.push(error.message); return "prepared" }
const hostPreparesStackTraces = new Error("probe").stack === "prepared"
prepared.length = 0
console.log(ignoresInOneFunction(1), readsTheMessage(1), prepared.join(","))
try { passesItOn(2) } catch (e) { const stack = (e as Error).stack; console.log(hostPreparesStackTraces ? stack : "prepared", hostPreparesStackTraces ? prepared.join(",") : "passed on") }
