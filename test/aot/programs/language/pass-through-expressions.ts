// Every expression form that passes a value through unchanged: `satisfies`, assignments, the comma operator, parentheses, conditionals.
declare const console: { log(...values: unknown[]): void };
function run(f: () => void) { f(); }
function row(name: string, f: () => unknown) {
    let said: string;
    try { const got = f(); said = typeof got + " " + JSON.stringify(got); } catch (error) { said = "threw " + (error as Error).name + " " + (error as Error).message; }
    console.log(name + ": " + said);
}
function take(x: string | undefined) { return x; }
row("the name alone", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = id; return { v }; });
row("satisfies unknown", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = id satisfies unknown; return { v }; });
row("satisfies its own type", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = id satisfies string | undefined; return { v }; });
row("satisfies twice", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = (id satisfies unknown) satisfies unknown; return { v }; });
row("an assignment to itself", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = (id = id); return { v }; });
row("an assignment to another", () => { let id: string | undefined = undefined; let other: string | undefined; run(() => { id = "a" }); const v = (other = id); return { v, other }; });
row("behind a comma", () => { let id: string | undefined = undefined; const v = (run(() => { id = "a" }), id); return { v }; });
row("satisfies under a condition", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = take("x") ? (id satisfies unknown) : null; return { v }; });
row("a condition that satisfies", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = (take("x") ? id : null) satisfies unknown; return { v }; });
row("satisfies under ??", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = take(undefined) ?? (id satisfies unknown); return { v }; });
row("satisfies under ||", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = take(undefined) || (id satisfies unknown); return { v }; });
row("satisfies under &&", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = take("x") && (id satisfies unknown); return { v }; });
row("satisfies and then !", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const v = (id satisfies unknown)!; return { v }; });
row("as the value of a property", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return { v: id satisfies unknown }; });
row("as an element", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return [id satisfies unknown]; });
row("as an argument", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return take(id satisfies unknown); });
row("as what is returned", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return id satisfies unknown; });
function returned() { let id: string | undefined = undefined; run(() => { id = "a" }); return id satisfies unknown; }
row("as what a declared function returns", () => { const v = returned(); return { v }; });
function assigned() { let id: string | undefined = undefined; let kept: string | undefined; run(() => { id = "a" }); return kept = id; }
row("an assignment that is returned", () => { const v = assigned(); return { v }; });
row("a number", () => { let n: number | undefined = undefined; run(() => { n = 1.5 }); const v = n satisfies unknown; return { v }; });
row("a number that is added to", () => { let n: number | undefined = 1; run(() => { n = 1.5 }); const v = n satisfies unknown; return { v, more: v + 1 }; });
row("a number narrowed to a literal", () => { let n: number = 1; run(() => { n = 2.5 }); const v = n satisfies number; return { v, more: v * 2 }; });
row("a boolean", () => { let b: boolean | undefined = undefined; run(() => { b = true }); const v = b satisfies unknown; return { v }; });
row("an object", () => { let o: { x: number } | undefined = undefined; run(() => { o = { x: 1 } }); const v = o satisfies unknown; return { v }; });
row("a property", () => { const o: { id: string | undefined } = { id: undefined }; o.id = undefined; run(() => { o.id = "a" }); const v = o.id satisfies unknown; return { v }; });
row("an element", () => { const a: (string | undefined)[] = [undefined]; a[0] = undefined; run(() => { a[0] = "a" }); const v = a[0] satisfies unknown; return { v }; });
row("a let that takes it", () => { let id: string | undefined = undefined; run(() => { id = "a" }); let v = id satisfies unknown; return { v }; });
row("a pattern's default", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const { v = id satisfies unknown } = {} as { v?: string }; return { v }; });
row("a template", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return `${id satisfies unknown}`; });
row("typeof", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return typeof (id satisfies unknown); });
row("compared", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return (id satisfies unknown) === undefined; });
row("CONTROL: the name alone as an element", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return [id]; });
row("CONTROL: the name alone as an argument", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return take(id); });
row("CONTROL: the name alone in a template", () => { let id: string | undefined = undefined; run(() => { id = "a" }); return `${id}`; });
row("CONTROL: nobody else stores: satisfies", () => { let id: string | undefined = undefined; const v = id satisfies unknown; return { v }; });
row("CONTROL: nobody else stores: an assignment", () => { let id: string | undefined = "b"; let other: string | undefined; const v = (other = id); return { v, other }; });
row("CONTROL: a const", () => { const id: string | undefined = take("c"); const v = id satisfies unknown; return { v }; });
row("a property read back", () => { let id: string | undefined = undefined; run(() => { id = "a" }); const o = { v: id satisfies unknown }; const back = o.v; return { back }; });
row("a chain of assignments", () => { let id: string | undefined = undefined; let a: string | undefined, b: string | undefined; run(() => { id = "a" }); const v = (a = b = id); return { v, a, b }; });
row("a comma in a loop's head", () => { let id: string | undefined = undefined; let seen: unknown; for (let i = 0; i < 1; run(() => { id = "a" }), seen = id, i++) { } return { seen }; });
class Holder { kept: string | undefined = undefined; set(f: () => void) { this.kept = undefined; f(); const v = this.kept satisfies unknown; return { v }; } }
row("a field of this", () => { const h = new Holder(); return h.set(() => { h.kept = "a" }); });
