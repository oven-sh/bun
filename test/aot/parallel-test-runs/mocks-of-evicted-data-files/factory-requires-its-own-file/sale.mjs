import tax from "./tax.json";
const read = () => { try { return tax.rate; } catch (error) { return error.message.split("\n")[0]; } };
console.log("sale runs", read());
export const sold = () => read();
