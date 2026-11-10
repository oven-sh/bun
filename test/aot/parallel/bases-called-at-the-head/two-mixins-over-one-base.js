// Named and Sized both call Base on the same new object: what Base lays is laid twice.
// STATISTIC: FieldsListedAtBirthsByConstructors = 0
function Base(tag) { this.tag = tag; }
function Named(name) { Base.call(this, "named"); this.name = name; }
function Sized(size) { Base.call(this, "sized"); this.size = size; }
function Box(name, size) { Named.call(this, name); Sized.call(this, size); this.full = false; }
Object.setPrototypeOf(Named.prototype, Base.prototype);
Object.setPrototypeOf(Sized.prototype, Base.prototype);
Object.setPrototypeOf(Box.prototype, Base.prototype);
function run(count) { let text = ""; for (let i = 0; i < count; i++) { const box = new Box("b" + i, i); text = box.tag + " " + box.name + " " + box.size + " " + box.full + " " + Object.keys(box).join(); } return text; }
console.log(run(10));
