// An index is a key like any other to the object: it warns about what is stored there.
// Env: BUN_OPTIONS=--pending-deprecation
process.env[7] = undefined;
console.log(process.env[7]);
