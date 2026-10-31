// `bun build` defines `process.browser` by itself. A --drop of that name is the program's own: a call is dropped in every spelling, and a read asks the run.
// Flags: --drop=process.browser
// Reference: bun build --compile
let evaluated = 0;
process.browser(evaluated++);
process["browser"](evaluated++);
process?.browser(evaluated++);
process.browser.call(process, evaluated++);
console.log(evaluated, typeof process.browser, typeof process["browser"]);
