// A key that spells the name of a loader is no text that anybody evaluates: the world stays closed.
// STATISTIC: FunctionsLowered <= 60
const listed = Object.keys({ require: 1, import: 2 });
console.log(listed.join(" "));
