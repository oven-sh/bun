// `const [first, ...rest] = numbers` takes an array, a set or an object with an iterator of its own, in a module that is imported at run time. Built with little work allowed for escape analysis.
// Flags: --aot-limit=MaxEscapeAnalysisWork:1 --aot-verify-each-pass
await import("./lists.ts");
export {};
