// `let k ="kind"; node[k]` is built as `node.kind`. Between two reads the field becomes an accessor, goes away, and comes back above the object.
// Under: --aot-testing=CheckProofsAtRunTime: the field that an access under a written key goes to
class Item { constructor(kind) { this.kind = kind; this.size = 1; } }
function kindOf(node) { let k ="kind"; return node[k]; }
function setKind(node, value) { let k ="kind"; node[k] = value; }
const lines = [];
const item = new Item("a");
lines.push(kindOf(item));
let reads = 0;
Object.defineProperty(item, "kind", { get() { reads++; return "getter"; }, set(value) { lines.push("setter " + value); }, configurable: true });
lines.push(kindOf(item));
setKind(item, "b");
lines.push(kindOf(item), reads);
delete item.kind;
lines.push(String(kindOf(item)));
Item.prototype.kind = "above";
lines.push(kindOf(item), kindOf(new Item("own")));
setKind(item, "again");
lines.push(kindOf(item), Object.keys(item).join());
console.log(lines.join("\n"));
