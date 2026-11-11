const again = Number(process.argv.length > 99);
class Node { constructor(i, has) { this.issues = i; if (has) this.aborted = 5; } size() { return 1; } }
class Below extends Node { deep() { return 2; } }
function make(i, has) { return new Below(i, has); }
function read(o, deed) { const said = o.aborted ? "yes" : "no"; if (deed) deed(o); return said + (o.aborted ? "yes" : "no") + String(o.aborted === true) + typeof o.aborted; }
export { make, read };
export { Node, Below };
