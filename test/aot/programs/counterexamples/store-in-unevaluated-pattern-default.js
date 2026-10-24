// A store inside the default of a pattern element does not happen when the element has a value.
let f, a;
const one = () => 1, later = () => { f = one; };
[a = (f = one)] = [1];
try { console.log(f()); } catch (e) { console.log(e.name); }
