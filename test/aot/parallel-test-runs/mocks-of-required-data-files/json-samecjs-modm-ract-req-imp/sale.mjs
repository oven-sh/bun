import tax from "./m.json";
const read = () => { try { return tax.v + "," + tax.n; } catch (error) { return error.name; } };
export const sold = () => read();
