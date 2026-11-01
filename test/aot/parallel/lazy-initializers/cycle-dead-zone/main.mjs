// Two files import each other. A read that comes before the declaration has run throws where it stands.
// Alone: what is put off goes by all that the executable holds
import { readA } from "./a.mjs";
import { fromB } from "./b.mjs";
console.log(fromB(), readA().title.text);
