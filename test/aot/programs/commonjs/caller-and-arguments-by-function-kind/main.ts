// `caller` and `arguments` of a function that is not running: null for a sloppy function, and a store to them does nothing; every other kind of function throws. By a read, by the getters of Function.prototype borrowed, by Reflect.get. A library reads `toss.caller` to say where a stack trace should start.
import "./kinds.cjs";
