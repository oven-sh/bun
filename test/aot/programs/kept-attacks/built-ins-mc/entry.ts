// Built ins mc, one probe of many. It prints what plain Bun prints.
const five: any = 5;
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).name); }
}
function pathToText(filepath: string) { return "file://" + filepath; }
attempt("given 5", () => pathToText(five));
