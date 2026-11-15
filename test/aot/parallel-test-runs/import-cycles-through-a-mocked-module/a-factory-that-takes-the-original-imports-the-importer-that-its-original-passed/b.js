import { name } from "./a.js"; export const readA = () => { try { return name; } catch (e) { return e.constructor.name; } };
