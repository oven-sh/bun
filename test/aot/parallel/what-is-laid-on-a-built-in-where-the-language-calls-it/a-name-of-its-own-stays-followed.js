// The language calls nothing under a name of the program's own: the definition is followed, and `process` is handed to nobody.
// STATISTIC: FunctionsLowered <= 60
// STATISTIC: ImageFunctionsEmitted <= 5 Todo: ten functions are emitted today where the program needs two
Object.defineProperty(process, "madeUp", { value: 7 });
console.log("SAID", process.madeUp);
