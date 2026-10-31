import * as ns from "./odd.json";
const held = ns;
console.log(Object.keys(held).join("|"), typeof held.default, held.class, held.$x, held["a-b"], held[""]);
