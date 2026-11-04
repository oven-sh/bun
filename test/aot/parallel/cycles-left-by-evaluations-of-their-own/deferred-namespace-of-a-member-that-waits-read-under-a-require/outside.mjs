import defer * as whole from "./second.mjs";
const read = () => { try { return whole.value; } catch (error) { return error.name; } };
export const seen = read();
export const again = read;
