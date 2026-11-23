// The warning is made only where an option asks for it: then native code calls the printer of warnings of the library. It names the process and the executable, which differ from run to run: it goes to no file.
// Env: BUN_OPTIONS=--pending-deprecation --redirect-warnings=/dev/null
const holder = process.argv.length > 99 ? {} : process.env;
holder.MADE_UP_OBJECT = {};
console.log(process.env.MADE_UP_OBJECT);
