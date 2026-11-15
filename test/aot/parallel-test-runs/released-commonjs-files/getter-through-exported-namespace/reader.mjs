import { inner } from "./way1.mjs";
const tell = f => { try { return f(); } catch (error) { return error.name; } };
export const read = () => tell(() => inner.word);
