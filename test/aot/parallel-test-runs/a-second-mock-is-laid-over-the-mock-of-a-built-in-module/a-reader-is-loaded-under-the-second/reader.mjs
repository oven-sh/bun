import { sep } from "node:path";
const safe = take => { try { return String(take()); } catch (error) { return error.constructor.name; } };
export const late = () => safe(() => sep);
