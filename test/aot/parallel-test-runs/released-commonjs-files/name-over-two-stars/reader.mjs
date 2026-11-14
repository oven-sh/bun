import { word, other } from "./way2.mjs";
const tell = f => { try { return f(); } catch (error) { return error.name; } };
export const read = () => tell(() => (word + other));
