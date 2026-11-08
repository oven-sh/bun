// plain.cjs says nothing of its kind. It stands in front of two CommonJS files that each hold a require of it, called when all is loaded.
import "./plain.cjs";
import real from "./real.cjs";
import other from "./other-real.cjs";
console.log("main", typeof real.load(), typeof other.load());
