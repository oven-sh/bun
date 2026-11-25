// `"name" in object` with a written name asks for that member alone.
// STATISTIC: FunctionsLowered <= 600
console.log("pid" in process, "nothingOfThisName" in process, "version" in Bun);
