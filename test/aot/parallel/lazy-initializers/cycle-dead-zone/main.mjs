// Two files import each other. A read that comes before the declaration has run throws where it stands.
import { readA } from "./a.mjs";
import { fromB } from "./b.mjs";
console.log(fromB(), readA().title.text);
