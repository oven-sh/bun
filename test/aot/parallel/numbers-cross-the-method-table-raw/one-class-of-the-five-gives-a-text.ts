// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the form in which a number crosses a call is a matter of the calling convention: the checks read every unit against the plan
// One row gives a text: a selector has one form for all its rows, so every row boxes what it gives.
interface Part { show(at: number): number | string }
class Whole implements Part { show(at: number) { return at | 0; } }
class Half implements Part { show(at: number) { return at / 2; } }
class Twice implements Part { show(at: number) { return at * 2; } }
class Named implements Part { show(at: number) { return "n" + at; } }
class Less implements Part { show(at: number) { return at - 1; } }
const parts: Part[] = [new Whole(), new Half(), new Twice(), new Named(), new Less()];
let text = "";
let sum = 0;
for (let i = 0; i < 200; i++) { const shown = parts[i % 5]!.show(i + 0.5); if (typeof shown === "number") sum += shown; else text = shown; }
console.log(sum, text);
