// NODE_ENV is "production" where the program runs and not set where it is built. Each arm calls its own function. `bun run` prints "production" first. `bun build --compile` replaces process.env.NODE_ENV by "development" at build time and prints that, and --aot follows it; every other way of reading the variable finds the real one.
// Env: NODE_ENV=production
// Env: OWN_FLAG=1
// Reference: bun build --compile
function production() { return "production"; }
function development() { return "development"; }
function other() { return "something else"; }
function viaPattern() { return "production, read with a pattern"; }
function viaBun() { return "production, read from Bun.env"; }
function viaImportMeta() { return "production, read from import.meta.env"; }
function custom() { return "a variable of the program's own"; }

console.log(process.env.NODE_ENV === "production" ? production() : process.env.NODE_ENV === "development" ? development() : other());
const { NODE_ENV } = process.env;
if (NODE_ENV === "production") console.log(viaPattern());
if (Bun.env.NODE_ENV === "production") console.log(viaBun());
if (import.meta.env.NODE_ENV === "production") console.log(viaImportMeta());
if (process.env.OWN_FLAG === "1") console.log(custom());
