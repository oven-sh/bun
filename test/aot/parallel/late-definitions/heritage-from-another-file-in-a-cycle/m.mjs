import { A } from "./a.mjs";
export const early = (() => { try { return typeof A; } catch (e) { return e.name; } })();
let B;
try { B = class extends A {}; } catch (e) { console.log("at the declaration:", e.name); }
export const read = () => B;
