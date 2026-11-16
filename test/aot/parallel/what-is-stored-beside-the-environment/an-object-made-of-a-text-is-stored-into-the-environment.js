// The warning is made only where an option asks for it: then native code calls the printer of warnings of the library. It names the process and the executable, which differ from run to run: it goes to no file.
// Env: BUN_OPTIONS=--pending-deprecation --redirect-warnings=/dev/null
process.env.MADE_UP_TEXT = new String("wrapped");
console.log(process.env.MADE_UP_TEXT);
