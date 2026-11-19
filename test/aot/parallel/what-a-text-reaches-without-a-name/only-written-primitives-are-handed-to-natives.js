// Every expression is a primitive that is written out, a name bound to a built-in, or a call of one whose answer is dropped: no value reaches native code that could be asked for anything.
// STATISTIC: FunctionsLowered = 1
// STATISTIC: SourceFilesRuntime = 0
console.log(1);
console.log(true, null, "a");
console.table("a");
console.log("%o %s %d", "a", "b", 3);
