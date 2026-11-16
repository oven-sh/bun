import { declared } from "./second.mjs";
const hidden = value => { try { throw value; } catch (caught) { return caught; } };
export const early = hidden(declared)(4);
