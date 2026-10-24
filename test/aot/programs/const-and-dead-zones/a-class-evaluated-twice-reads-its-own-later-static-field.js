// A class evaluated twice shares nothing: the second evaluation's field is not yet defined while the first's is.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function make(k) {
  return class K {
    static first = k ? attempt(() => K.second.x) : 0;
    static second = { x: k };
  };
}
const A = make(0), B = make(1);
console.log(A.first, B.first, A.second.x, B.second.x);
