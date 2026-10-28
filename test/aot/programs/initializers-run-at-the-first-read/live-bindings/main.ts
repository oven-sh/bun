// An import shows what the exporting module stores later.
import * as whole from "./values";
import { changing, change, fixed, table } from "./values";
const names = Object.keys(whole).sort();
console.log(names.join());
console.log(JSON.stringify(changing), JSON.stringify((whole as any)["chan" + "ging"]));
change();
console.log(JSON.stringify(changing), JSON.stringify((whole as any)["chan" + "ging"]), fixed === (whole as any)["fix" + "ed"], table === whole.table);
for (const name of names) console.log(name, typeof (whole as any)[name]);
