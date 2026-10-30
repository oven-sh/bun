import defer * as a from "./a.mjs";
console.log("main begins");
console.log(a.value);
console.log(a.bump(), a.value, a.arrow(), a.default, a.LIMIT, new a.Thing() instanceof a.Thing, a.Thing.made);
