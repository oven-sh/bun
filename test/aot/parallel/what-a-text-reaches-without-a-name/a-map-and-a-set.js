// The classes are made and their methods are read by name. Native code walks what native code has made: `new Map(ages)`, `new Set(ages.keys())`.
// STATISTIC: FunctionsLowered <= 400
// STATISTIC: SourceFilesRuntime <= 50
const ages = new Map([["ann", 31], ["bob", 27]]);
const seen = new Set(ages.keys());
let total = 0;
ages.forEach(age => {
  total += age;
});
console.log(ages.get("ann"), seen.has("bob"), total, new Map(ages).size, new Set(seen).size, new Set([3, 4].values()).size);
