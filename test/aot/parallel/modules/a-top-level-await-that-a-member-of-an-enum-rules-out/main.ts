// Each file queues a job that sets a flag, and has a top-level `await`. `bun run` writes the value in place of a read of a member of an enum and removes what that rules out:
// without its `await` the file is an ordinary module, and the file that imports it finds the flag not yet set. The files whose names start with "kept" keep theirs.
console.log("zero", (await import("./reads-zero.ts")).seen);
console.log("exported-enum", (await import("./reads-exported-enum.ts")).seen);
console.log("not", (await import("./reads-not.ts")).seen);
console.log("right-of-or", (await import("./reads-right-of-or.ts")).seen);
console.log("const-enum", (await import("./reads-const-enum.ts")).seen);
console.log("read-above-the-enum", (await import("./reads-read-above-the-enum.ts")).seen);
console.log("enum-in-a-namespace", (await import("./reads-enum-in-a-namespace.ts")).seen);
console.log("kept-reached", (await import("./reads-kept-reached.ts")).seen);
console.log("kept-behind-type-of", (await import("./reads-kept-behind-type-of.ts")).seen);
console.log("kept-behind-a-constant-below-other-statements", (await import("./reads-kept-behind-a-constant-below-other-statements.ts")).seen);
