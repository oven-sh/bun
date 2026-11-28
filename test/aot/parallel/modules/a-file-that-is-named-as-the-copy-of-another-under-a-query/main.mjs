// A file on the disk keeps its name where the build makes a name for the copy of another file under a query.
import { name as copy } from "./a.mjs?x";
import { name as first } from "./a%3fx.mjs";
import { name as second } from "./a%3fx%_x.mjs";
import { name as twice } from "./a.mjs?x?y";
import { name as other } from "./a%3fx.mjs?y";
console.log(copy, first, second, twice, other);
