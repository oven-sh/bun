// An object that goes through `as string` or `as number` passes: a cast refuses no object, and the code behind it does with the object what JavaScript does. undefined and null pass. Any object passes a cast to an object type, and a field of another kind throws a TypeError at its typed read.
declare const console: { log(...args: unknown[]): void }
function hide(x: unknown): unknown { return x }
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
interface Host { text: string; size: number }
// CODE THAT ONLY INSPECTS
attempt("typeof", () => typeof (hide({}) as string))
attempt("===", () => { const o = hide({}); return (o as string) === o })
attempt("truthiness", () => (hide({}) as string) ? "yes" : "no")
attempt("??", () => typeof ((hide({}) as string) ?? "d"))
attempt("handed on to unknown", () => typeof hide(hide({}) as number))
attempt("an unannotated local, returned", () => { const s = hide([1]) as string; return typeof s })
attempt("?. on nil", () => (hide(undefined) as string)?.length)
// A USE THAT NEEDS THE PRIMITIVE
attempt("USE member", () => (hide({ length: 3 }) as string).length)
attempt("USE member, through a local", () => { const s = hide({ length: 3 }) as string; return s.length })
attempt("USE method", () => (hide({ trim() { return "t" } }) as string).trim())
attempt("USE index", () => (hide(["a"]) as string)[0])
attempt("USE +", () => (hide({}) as number) + 1)
attempt("USE + through a local", () => { const n = hide({}) as number; const m = n + 1; return typeof m })
attempt("USE -x", () => -(hide({ valueOf() { return 2 } }) as number))
attempt("USE <", () => (hide({ valueOf() { return 0 } }) as number) < 1)
attempt("USE template", () => `${hide([1, 2]) as string}!`)
attempt("USE +=", () => { let sum = 0; sum += hide({ valueOf() { return 2 } }) as number; return sum })
attempt("USE ++", () => { let n = hide({ valueOf() { return 2 } }) as number; n++; return n })
attempt("USE a read through a cast object", () => (hide({ text: { length: 7 } }) as Host).text.length)
// HONEST
attempt("honest member", () => (hide("abc") as string).length)
attempt("honest +", () => (hide(2) as number) + 1)
attempt("honest read", () => (hide({ text: "abcd", size: 1 }) as Host).text.length)
attempt("honest nil +", () => (hide(undefined) as number) + 1)
attempt("honest nil member", () => (hide(undefined) as string).length)
attempt("honest template", () => `${hide("x") as string}!`)
