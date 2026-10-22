// Inheritance as it was written before classes: `Child.prototype = new Parent()`. The prototype of the children is itself a compiled object with slots.
// A typed store that fills an empty slot of that one object, which looks like any first store, changes what every child inherits.
interface Parent {
  kind: number;
  note?: string;
  count?: number;
}
interface Child extends Parent {
  id: number;
}
function Parent(this: Parent) {
  this.kind = 1;
}
function Child(this: Child, id: number) {
  this.id = id;
}
const ParentClass = Parent as any as new () => Parent;
const ChildClass = Child as any as new (id: number) => Child;
const shared = new ParentClass();
Child.prototype = shared;
Child.prototype.constructor = Child;

function noteOf(object: Parent) {
  return object.note;
}
function setNote(object: Parent, value: string) {
  object.note = value;
}
function noteOfChild(child: Child) {
  return child.note;
}
function setNoteOfChild(child: Child, value: string) {
  child.note = value;
}
function countUp(child: Child) {
  child.count = (child.count ?? 0) + 1;
  return child.count;
}
function state(child: Child) {
  return `${noteOfChild(child)} ${child.count} ${child.kind} ${"note" in child} [${Object.keys(child)}]`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const child = new ChildClass(i);
  const parent = new ParentClass();
  length += (noteOfChild(child) ?? "-").length + (noteOf(parent) ?? "-").length;
  if (i & 1) setNoteOfChild(child, "own");
  if (i & 2) setNote(parent, "mine");
  if (i & 4) countUp(child);
  length += state(child).length + (noteOf(parent) ?? "-").length;
}
console.log("warm", length);

const empty = new ChildClass(1);
const filled = new ChildClass(2);
setNoteOfChild(filled, "own");
console.log("before:", state(empty), "|", state(filled));
setNote(shared, "of the shared parent");
console.log("the parent's slot is filled:", state(empty), "|", state(filled), "|", state(new ChildClass(3)));
shared.count = 10;
console.log("counting starts from what is inherited:", countUp(empty), countUp(empty), countUp(new ChildClass(4)), shared.count);
delete shared.note;
console.log("the parent's slot is emptied:", state(empty), "|", state(filled));
(Parent.prototype as any).note = "of the grandparent";
console.log("two levels up:", state(empty), "|", noteOf(shared), "|", noteOf(new ParentClass()));
setNote(shared, "nearer");
console.log("hidden by the nearer one:", state(empty), "|", noteOf(new ParentClass()));
delete shared.note;
delete (Parent.prototype as any).note;
delete shared.count;
console.log("gone again:", state(empty), "|", state(new ChildClass(5)));
