const again = Number(process.argv.length > 99);
class Node { constructor(i) { this.issues = i; } size() { return 1; } }
class Below extends Node { deep() { return 2; } }
function make(i) { return new Below(i); }
async function read(o, deed) { const before = o.aborted; await null; if (deed) deed(o); const between = o.aborted; await null; return String(before) + "," + String(between) + "," + String(o.aborted); }
export { make, read };
export { Node, Below };
