// The warning is made only where an option asks for it: then native code calls the printer of warnings of the library. It names the process and the executable, which differ from run to run: it goes to no file.
// Env: BUN_OPTIONS=--pending-deprecation --redirect-warnings=/dev/null
try {
  process.env.MADE_UP_MARK = Symbol("mark");
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(typeof process.env.MADE_UP_MARK);
