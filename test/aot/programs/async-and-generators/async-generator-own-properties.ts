// Async generator objects that the program has given properties of their own: a harmless one, `next`, `return`, `throw`, Symbol.asyncIterator;
// as data, as accessors, added before the loop and in the middle of it, taken away again; consumed by `for await`, by `yield*` and by next() written out.
const lines: string[] = [];
async function* count(label: string, n: number): AsyncGenerator<string, string> {
    try {
        for (let i = 0; i < n; i++) yield label + i;
        return label + " is over";
    } finally {
        lines.push(label + " is closed");
    }
}
async function* other(): AsyncGenerator<string> {
    yield "from the other";
}
async function collect(title: string, source: AsyncIterable<string>, limit = 99): Promise<void> {
    const seen: string[] = [];
    try {
        for await (const x of source) { seen.push(x); if (seen.length >= limit) break; }
    } catch (error) {
        seen.push("caught " + (error instanceof TypeError ? "TypeError" : (error as Error).message));
    }
    lines.push(title + ": " + seen.join(" "));
}
async function* through(source: AsyncGenerator<string, string>): AsyncGenerator<string> {
    yield "returned: " + (yield* source);
}
function withProperty<T extends object>(target: T, key: PropertyKey, value: unknown): T {
    return Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
let calls = 0;
const kinds: [string, () => AsyncGenerator<string, string>][] = [
    ["as made", () => count("a", 2)],
    ["a harmless property", () => withProperty(count("b", 2), "result", Promise.resolve(1))],
    ["two harmless properties", () => withProperty(withProperty(count("c", 2), "result", 1), "label", "c")],
    ["a symbol of its own", () => withProperty(count("d", 2), Symbol("mine"), 1)],
    ["next of its own", () => { const g = count("e", 2); return withProperty(g, "next", () => { calls++; return Promise.resolve({ done: calls % 3 === 0, value: "own next " + calls }); }); }],
    ["next of its own that calls the real one", () => { const g = count("f", 2); const real = g.next.bind(g); return withProperty(g, "next", () => { lines.push("next is called"); return real(); }); }],
    ["an iterator method of its own", () => withProperty(count("g", 2), Symbol.asyncIterator, () => other())],
    ["an iterator method that is undefined", () => withProperty(count("h", 2), Symbol.asyncIterator, undefined)],
    ["return of its own", () => { const g = count("i", 3); return withProperty(g, "return", (value: string) => { lines.push("own return"); return Promise.resolve({ done: true, value }); }); }],
    ["next as a getter", () => { const g = count("j", 2); const real = g.next; return Object.defineProperty(g, "next", { get() { lines.push("next is read"); return real; }, configurable: true }); }],
    ["next added and taken away", () => { const g = withProperty(count("k", 2), "next", () => { throw new Error("never"); }); delete (g as any).next; return g; }],
    ["frozen", () => Object.freeze(count("l", 2))],
    ["many properties", () => { const g = count("m", 2); for (let i = 0; i < 80; i++) (g as any)["p" + i] = i; return g; }],
];
for (const [title, make] of kinds) {
    await collect(title, make());
    await collect(title + ", broken off", make(), 1);
    await collect(title + ", through yield*", through(make()));
}
{
    const g = count("n", 4);
    const seen: string[] = [];
    for await (const x of g) {
        seen.push(x);
        if (x === "n1") withProperty(g, "next", () => Promise.resolve({ done: true, value: "late next" }));
    }
    lines.push("next added in the middle of a loop: " + seen.join(" "));
}
console.log(lines.join("\n"));
