import * as tax from "./m.toml";
const read = () => { try { return Object.keys(tax).sort().join() + " " + tax.v + "," + tax.n; } catch (error) { return error.name; } };
export const sold = () => read();
