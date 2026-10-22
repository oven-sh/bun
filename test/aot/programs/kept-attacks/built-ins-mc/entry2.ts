// Built ins mc, one probe of many. It prints what plain Bun prints.
const five: any = JSON.parse("5");
function pathToText(filepath: string) { return "file://" + filepath; }
try { console.log(pathToText(five)); } catch (e) { console.log((e as Error).name); }
