// With --disallow-code-generation-from-strings `new Function("")` throws although its text is a constant that could be compiled ahead of time. Libraries ask exactly that way whether they may generate code (zod: `const F = Function; new F("")`) and take their other path when it throws.
// Flags: --disallow-code-generation-from-strings
// Reference: bun build --compile
declare const console: { log(...values: unknown[]): void };
function attempt(label: string, action: () => unknown): void {
    try { console.log(label, String(action())); } catch (error) { console.log(label, (error as Error).constructor.name); }
}
function allowsEval(): boolean {
    try {
        const F = Function;
        new F("");
        return true;
    } catch {
        return false;
    }
}
attempt("the question libraries ask", allowsEval);
attempt("new Function, constant text", () => new Function("a", "return a + 1")(1));
attempt("Function, constant text", () => Function("return 2")());
attempt("indirect eval, constant text", () => (0, eval)("3"));
attempt("new Function, text made at run time", () => new Function("return " + [4].join())());
