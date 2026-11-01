// The table lists every member of import.meta and says where a lookup goes on, so the printer, JSON.stringify and String find nothing on it that nobody knows, but for `env`.
// Under `bun test` that is an object of its own with booleans in it, not the one of process.env, and the table has one row for every build: an object, no more. So util.inspect comes in.
// TODO: ImageFunctionsEmitted <= 8, once it is settled what `env` is outside a test run.
// A release emits 72 functions and removes 20 that are one jump. A Bun with assertions generates checks into two of those, so it emits 74 and removes 18.
// STATISTIC: ImageFunctionsAndJumpsInTheirPlace <= 92
console.log(import.meta);
console.log(JSON.stringify(import.meta), String(import.meta), Object.keys(import.meta), Reflect.ownKeys(import.meta));
console.log(import.meta.nothing, "nothing" in import.meta, typeof import.meta.url, typeof import.meta.main);
