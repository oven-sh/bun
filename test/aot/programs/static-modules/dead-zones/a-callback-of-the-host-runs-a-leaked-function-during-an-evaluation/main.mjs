// first.mjs leaves a function of a.mjs on the global object through a cycle; second.mjs, a later import of a.mjs, hands it to Array.prototype.map while b.mjs has not run.
import "./a.mjs";
