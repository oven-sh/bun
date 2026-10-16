// A literal and a spread go through `as any` into a parameter whose type has many optional members.
declare const console: { log(...values: unknown[]): void };
interface Input { files: Record<string, string>; a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number; k?: number; l?: number; run?: boolean }
const made: Input = { files: {}, a: 1 };
const forms = { files: { "/x.js": "1" }, run: true };
function it(name: string, opts: Input | Function): string { return typeof opts === "function" ? "fn" : name + " " + Object.keys(opts.files).length + " " + opts.run + " " + opts.l }
function row(n: string, f: () => unknown) { try { console.log(n + ": " + String(f())) } catch (e) { console.log(n + ": THROWN: " + (e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 170)) } }
row("made", () => it("m", made));
row("a spread behind as any", () => it("s", { ...forms } as any));
row("a literal behind as any", () => it("l", { files: {}, run: false } as any));
row("a spread behind as unknown as", () => it("u", { ...forms, l: 3 } as unknown as Input));
