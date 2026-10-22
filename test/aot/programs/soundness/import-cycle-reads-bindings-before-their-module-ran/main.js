// Import cycles: a hoisted function of a module whose body has not run reads its let, const, var, class; live bindings change value and type.
import { early, counter, inc, setText, later, K } from "./a.js";
console.log("main", early, counter, typeof counter);
inc(); console.log(counter); setText(); console.log(counter, typeof counter, counter + 1);
console.log(later(), new K().v);
