// process.isBun and process.browser are booleans that native code makes at the first read, and a program may store to both.
function whichRuntime() { return process.isBun ? "bun" : "other"; }
function inBrowser(name: string) { return (process as unknown as Record<string, unknown>)[name]; }
let line = "";
for (let round = 0; round < 300; round++)
  line = whichRuntime() + " " + typeof process.isBun + " " + inBrowser("browser") + " " + typeof inBrowser("browser");
console.log(line);
(process as unknown as Record<string, unknown>).isBun = 0;
console.log(whichRuntime(), Object.getOwnPropertyDescriptor(process, "isBun")?.writable);
