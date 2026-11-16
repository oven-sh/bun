const again = Number(process.argv.length > 99);
class Node { constructor(i) { this.issues = i; } size() { return 1; } }
class Below extends Node { deep() { return 2; } }
function make(i) { return new Below(i); }
function read(o, deed) { const before = o.aborted; if (deed) deed(o); const behind = o.aborted; return String(before) + "," + String(behind); }
export { make, read };
export { Node, Below };
