// The heir reads between the stores.
class Tree {} class Ash extends Tree {}
const all = [Tree, Ash]; all[0].hits = 0;
let seen = 0; for (let i = 0; i < 400; i++) { all[0].hits = all[0].hits + 1; seen += all[1].hits; } console.log(seen, Ash.hits, Tree.hits);
