import tax from "./m.toml";
const read = () => { try { return tax.v + "," + tax.n; } catch (error) { return error.name; } };
export const sold = () => read();
