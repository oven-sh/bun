// An accessor is defined over it in the middle.
class Tree {} class Ash extends Tree {}
const all = [Tree, Ash]; all[0].hits = 0; let heard = 0;
for (let i = 0; i < 400; i++) { if (i === 200) Object.defineProperty(Tree, "hits", { get() { return 7; }, set(value) { heard++; }, configurable: true }); all[0].hits = all[0].hits + 1; } console.log(heard, Tree.hits, Ash.hits);
