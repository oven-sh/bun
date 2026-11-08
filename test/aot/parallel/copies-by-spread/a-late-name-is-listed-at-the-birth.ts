// A constructor lays a name that the class does not declare. Where the arguments of `new` are reads out of slots of another object, the walk asks whether each goes into the slot that it came out of: of a late name too.
class Box { name: string; constructor(name: string, late: string) { this.name = name; (this as any).late = late; } }
class Source { name = "n"; label = "l"; }
function copy(source: Source): Box { return new Box(source.name, source.label); }
function again(box: Box): Box { return new Box(box.name, (box as any).late); }
let total = 0;
const source = new Source();
for (let i = 0; i < 3000; i++) { const box = again(copy(source)); total += box.name.length + (box as any).late.length; }
console.log(total);
