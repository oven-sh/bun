// The tsconfig.json includes files that the program does not import.
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# a-type-that-is-inferred-from-the-body-of-a-function-in-a-fil");
await import("./a-type-that-is-inferred-from-the-body-of-a-function-in-a-fil/main.ts");
await settled();
console.log("# a-file-that-only-the-body-of-a-function-in-a-file-that-nobod");
await import("./a-file-that-only-the-body-of-a-function-in-a-file-that-nobod/main.ts");
await settled();
console.log("# what-stands-in-the-bodies-of-functions-in-files-that-nobody-");
await import("./what-stands-in-the-bodies-of-functions-in-files-that-nobody-/main.ts");
await settled();
console.log("# what-a-file-that-nobody-imports-names-at-its-head-and-what-i");
await import("./what-a-file-that-nobody-imports-names-at-its-head-and-what-i/main.ts");
await settled();
