// b.mjs waits at its top level. d.mjs, on a cycle with a.mjs, has set a timer that calls a function of a.mjs, which reads a binding of b.mjs that is not there yet.
import "./a.mjs";
console.log("main");
