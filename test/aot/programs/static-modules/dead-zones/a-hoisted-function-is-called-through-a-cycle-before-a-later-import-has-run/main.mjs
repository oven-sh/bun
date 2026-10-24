// a.mjs imports d.mjs and then b.mjs. d.mjs imports a.mjs back and calls its hoisted function, which reads a binding of b.mjs, while b.mjs has not run.
import "./a.mjs";
