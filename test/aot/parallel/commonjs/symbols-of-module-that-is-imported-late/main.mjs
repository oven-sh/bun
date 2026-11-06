// The symbols of a CommonJS module name fields though import() starts the program: somebody may see each module before its body has ended, so each symbol is the symbol or undefined as far as the compiler knows.
const { run } = await import("./app.cjs");
console.log(run(5));
