// `f.bind(..)` on a known function that was given properties or another prototype beforehand.
const say = (what: string, ...values: unknown[]): void => console.log(what + ": " + values.map(v => typeof v === "function" ? "function" : String(v)).join(" | "))
{ const arrow = (a: number) => a; say("as made", arrow.bind(null).name, arrow.bind(null).length, arrow.bind(null)(3)) }
{ const arrow = (a: number) => a; Object.defineProperty(arrow, "name", { value: "renamed" }); say("a name", arrow.name, arrow.bind(null).name, arrow.bind(null)(3)) }
{ const arrow = (a: number, b: number) => a + b; Object.defineProperty(arrow, "length", { value: 7 }); say("a length", arrow.bind(null).length, arrow.bind(null, 1).length, arrow.bind(null, 1)(2)) }
{ function declared(a: number): number { return a * 2 } Object.defineProperty(declared, "name", { value: "other" }); say("a declared function", declared.bind(undefined).name, declared.bind(undefined)(4)) }
{ const k = 5, captures = (a: number) => a + k; Object.defineProperty(captures, "name", { value: "with captures" }); say("one that captures", captures.bind(null).name, captures.bind(null)(1)) }
{ const arrow = (a: number) => a, parent = Object.create(Function.prototype, { mark: { value: "inherited" } }); Object.setPrototypeOf(arrow, parent); const bound: any = arrow.bind(null); say("another prototype", Object.getPrototypeOf(bound) === parent, bound.mark, bound(9)) }
{ const arrow: any = (a: number) => a; arrow.extra = 1; say("a property that bind does not ask for", arrow.bind(null).name, arrow.bind(null).length, arrow.bind(null).extra, arrow.bind(null)(2)) }
{ const arrow = (a: number) => a; Object.defineProperty(arrow, "name", { value: 42 }); say("a name that is no string", JSON.stringify(arrow.bind(null).name)) }
{ const arrow = (a: number) => a; Object.defineProperty(arrow, "name", { get() { return "from a getter" } }); say("a name from a getter", arrow.bind(null).name) }
{ const arrow = (a: number) => a; delete (arrow as any).name; delete (arrow as any).length; say("name and length deleted", JSON.stringify(arrow.bind(null).name), arrow.bind(null).length) }
{ const arrow = (a: number) => a; const before = arrow.bind(null); Object.defineProperty(arrow, "name", { value: "later" }); const after = arrow.bind(null); say("bound before and after", before.name, after.name) }
{ let names = ""; for (let i = 0; i < 3; i++) { const arrow = (a: number) => a + i; if (i === 1) Object.defineProperty(arrow, "name", { value: "second" }); names += arrow.bind(null).name + "," + arrow.bind(null)(1) + ";" } say("in a loop, one of three changed", names) }
export {}
