// Loops over array.entries() that take the pair apart, inside and outside `try`, with every kind of element.
type Row = { e: string; value: string }
const rows = (): Row[] => [{ e: "a", value: "v" }, { e: "b", value: "w" }]
function guarded(name: string, f: () => void) { try { f() } catch (x) { console.log(name, "caught", x instanceof TypeError ? "TypeError" : String(x)) } }
function nestedInTry(a: Row[]) { try { for (const [i, { e, value }] of a.entries()) console.log("nested in try", i, e, value) } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
function nestedNoTry(a: Row[]) { for (const [i, { e, value }] of a.entries()) console.log("nested, no try", i, e, value) }
function plainInTry(a: Row[]) { try { for (const [i, r] of a.entries()) console.log("plain in try", i, r.e, r.value) } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
function closureInTry(a: Row[]) { try { for (const [i, { e, value }] of a.entries()) { const f = () => e + value; console.log("closure in try", i, f()) } } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
function reversedInTry(a: Row[]) { try { for (const [i, { e, value }] of a.reverse().entries()) console.log("reversed in try", i, e, value) } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
function finallyOnly(a: Row[]) { try { for (const [i, { e }] of a.entries()) console.log("finally", i, e) } finally { console.log("finally ran") } }
function numbersInTry(a: number[]) { let s = 0; try { for (const [i, n] of a.entries()) s += i * n } catch (x) { console.log("caught") } console.log("numbers in try", s) }
function stringsInTry(a: string[]) { try { for (const [i, { length }] of a.entries()) console.log("strings in try", i, length) } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
function arraysInTry(a: number[][]) { try { for (const [i, [x, y]] of a.entries()) console.log("arrays in try", i, x, y) } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
function holesInTry(a: (Row | undefined)[]) { try { for (const [i, r] of a.entries()) console.log("holes in try", i, r?.e) } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
function undefinedElementInTry(a: (Row | undefined)[]) { try { for (const [i, { e }] of a.entries() as IterableIterator<[number, Row]>) console.log("not reached twice", i, e) } catch (x) { console.log("destructuring undefined throws", x instanceof TypeError) } }
function throwsInBody(a: Row[]) { try { for (const [i, { e }] of a.entries()) { if (i === 1) throw new Error("stop at " + e); console.log("throws in body", i, e) } } catch (x) { console.log("caught", (x as Error).message) } }
function breaksInTry(a: Row[]) { try { for (const [i, { e }] of a.entries()) { if (i === 1) break; console.log("breaks in try", i, e) } } catch (x) { console.log("caught") } }
function growsInTry(a: Row[]) { try { for (const [i, { e }] of a.entries()) { if (i === 0) a.push({ e: "pushed", value: "p" }); console.log("grows in try", i, e) } } catch (x) { console.log("caught") } }
async function awaitBefore(a: Row[]) { try { await Promise.resolve(); for (const [i, { e, value }] of a.entries()) console.log("await before", i, e, value) } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
async function awaitInside(a: Row[]) { try { for (const [i, { e, value }] of a.entries()) { await Promise.resolve(); console.log("await inside", i, e, value) } } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
function mapInTry(m: Map<string, Row>) { try { for (const [k, { e, value }] of m) console.log("map in try", k, e, value) } catch (x) { console.log("caught", String(x).split("\n")[0]) } }
nestedInTry(rows()); nestedNoTry(rows()); plainInTry(rows()); closureInTry(rows()); reversedInTry(rows()); finallyOnly(rows())
numbersInTry([1.5, 2.5, 3]); stringsInTry(["a", "bc"]); arraysInTry([[1, 2], [3, 4]]); holesInTry([rows()[0], undefined, , rows()[1]]); undefinedElementInTry([rows()[0], undefined])
throwsInBody(rows()); breaksInTry(rows()); growsInTry(rows())
await awaitBefore(rows()); await awaitInside(rows()); mapInTry(new Map([["k", rows()[0]!]]))
guarded("outer try only", () => { for (const [i, { e, value }] of rows().entries()) console.log("outer try only", i, e, value) })
