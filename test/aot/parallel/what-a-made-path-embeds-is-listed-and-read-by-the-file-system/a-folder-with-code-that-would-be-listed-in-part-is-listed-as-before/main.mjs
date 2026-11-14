import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "parts");
const names = fs.readdirSync(folder).sort();
console.log(names.join(" "));
for (const name of names) console.log(name, require(path.join(folder, name)).is);
process.exit(0);
/* Output:
a.cjs
a.cjs a
*/
