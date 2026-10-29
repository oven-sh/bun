// `const [first, ...others] = list` copies the rest of a list in a loop that reads one list and appends to a new one. Built with little work allowed for escape analysis.
// Flags: --aot-limit=MaxEscapeAnalysisWork:4 --aot-verify-each-pass
function restOfNumbers(list: number[]): number[] { const [first, ...others] = list; return others; }
function restOfArguments(first: unknown, ...given: unknown[]): unknown[] { const [second, ...others] = given; return others; }
for (const list of [[], [1], [1, 2], [1.5, 2.5, 3.5], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) console.log(JSON.stringify(restOfNumbers(list)));
console.log(JSON.stringify(restOfArguments(0)), JSON.stringify(restOfArguments(0, 1)), JSON.stringify(restOfArguments(0, 1, 2, 3)));
export {};
