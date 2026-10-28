// The key of the store is known only at run time.
const heir = Object.create(globalThis);
heir[process.argv[5] ?? "self"] = "under a key made at run time";
console.log(Object.hasOwn(heir, "self"), self);
