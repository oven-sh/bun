// The class lists a static method under the computed key "constructor", which lies on the class object and not on the prototype.
class Tree { k = 1; static ["constructor"](): string { return "static"; } again(): any { return new (this as any).constructor(); } }
(globalThis as any).held = Tree;
const first = new Tree(); let sum = 0;
for (let i = 0; i < 300; i++) { const made = first.again(); sum += made.k + (made.constructor === Tree ? 10 : 0); }
console.log(sum, typeof (Tree as any).constructor, (Tree as any).constructor());
