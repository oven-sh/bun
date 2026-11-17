import * as tax from "./tax.cjs";
import dflt from "./tax.cjs";
export const used = () => [tax.rate, typeof dflt, Object.keys(tax).sort().join("+")].join();
