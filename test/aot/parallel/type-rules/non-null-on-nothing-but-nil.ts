// `x!` checks nothing, as in TypeScript. `let a: T = undefined!` says "I fill this in later": the value passes unchanged, the place that receives it takes it, whatever its type, and what follows runs. So does a value of type `T | undefined` that is `undefined` when the program runs. Every line prints what plain Bun prints.
declare const console: { log(...values: unknown[]): void };
const hide = (value: unknown): unknown => value;
function attempt(label: string, action: () => unknown): void {
    try { console.log(label, String(action())); } catch (error) { console.log(label, (error as Error).constructor.name); }
}

const missing = undefined;
const empty = null;
const either = hide(1) === 1 ? undefined : null;
function returnsNothing(): void {}
function takesNumber(value: number): unknown { return value; }
function takesText(value: string): unknown { return value; }
function givesNumber(): number { return undefined!; }
function givesText(): string { return null!; }
class Holder {
    count: number = undefined!;
    text: string = null!;
    names: Set<string> = undefined! as Set<string>;
    private later: number = undefined!;
    fill(): number { this.later = 3; return this.later; }
}

attempt("undefined! into a variable", () => { const kept: string = undefined!; return kept; });
attempt("null! into a variable", () => { const kept: number = null!; return kept; });
attempt("a constant that is undefined", () => { const kept: string = missing!; return kept; });
attempt("a constant that is null", () => { const kept: number = empty!; return kept; });
attempt("undefined or null", () => { const kept: number = either!; return kept; });
attempt("the result of a void function", () => { const kept: string = returnsNothing()!; return kept; });
attempt("into a number parameter", () => takesNumber(undefined!));
attempt("into a string parameter", () => takesText(null!));
attempt("as a number result", () => givesNumber());
attempt("as a string result", () => givesText());
attempt("in a number field", () => new Holder().count);
attempt("in a string field", () => new Holder().text);
attempt("under a cast, in a field", () => new Holder().names);
attempt("a field that is filled later", () => new Holder().fill());
attempt("a field of numbers after it is filled", () => { const holder = new Holder(); holder.count = 2; return holder.count + 1; });
attempt("as an element", () => { const list: number[] = [undefined!, 1]; return list[0] + "," + list[1]; });
attempt("as a member of a literal", () => { const result: { value: number; done: boolean } = { value: undefined!, done: true }; return result.value + "," + result.done; });
attempt("under a cast, filled later", () => { const holder = { names: undefined! as Set<string> }; holder.names = new Set(["a"]); return holder.names.size; });
attempt("what follows runs", () => { const kept: string = undefined!; return kept === undefined ? "reached" : "wrong"; });

attempt("a string or undefined that is a string", () => (hide("a") as string | undefined)!);
attempt("a string or undefined that is undefined", () => (hide(undefined) as string | undefined)!);
attempt("a number or null that is null", () => (hide(null) as number | null)!);
attempt("an unknown value that is null", () => hide(null)!);
attempt("an any value that is undefined", () => (hide(undefined) as any)!);
