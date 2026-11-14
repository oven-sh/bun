export * from "./m.cjs";
import { v } from "./m.cjs";
export const sold = () => { try { return String(v); } catch (error) { return error.name; } };
