import tax from "./m.json";
const read = () => { try { return tax.v + "," + tax.n; } catch (error) { return error.name; } };
console.log("SAID sale runs", read());
export const sold = () => read();
