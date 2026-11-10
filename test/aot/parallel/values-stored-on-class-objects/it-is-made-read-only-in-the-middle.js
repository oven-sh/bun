"use strict";
// It is made read only in the middle.
class Tree {} class Ash extends Tree {}
const all = [Tree, Ash]; all[0].hits = 0; let thrown = 0;
for (let i = 0; i < 400; i++) { if (i === 200) Object.defineProperty(Tree, "hits", { writable: false }); try { all[0].hits = all[0].hits + 1; } catch { thrown++; } } console.log(thrown, Tree.hits, Ash.hits);
