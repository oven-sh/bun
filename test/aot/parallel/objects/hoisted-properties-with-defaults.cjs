// Flags: --aot-harden=proof-checks
// A property with a written default is read in front of a loop: what the loop reads again for the check stands without the default.
const table = {
  empty(module) { },
  counted(module) { class Counted { sum() { let s = 0; for (let i = 0; i < 20; ++i) s += (this.count || 0) + i; return s; } } module.exports = Counted; },
};
function load(id) { const module = { exports: {} }; table[id](module, module.exports, load); return module.exports; }
function attempt(id) { try { return load(id); } catch (e) { return Object; } }
const all = [attempt("empty"), attempt("counted"), attempt("missing")];
for (let round = 0; round < 3; ++round) for (let i = 0; i < all.length; ++i) {
    let K = all[i], made;
    try { made = K.make && round === 1 ? K.make(round) : new K(round); } catch (e) { continue; }
    let s = 0;
    for (let j = 0; j < 30; ++j) { if (made.sum) s += made.sum(); }

    console.log(i, s, made.sum ? made.sum() : "none");
}
