import { list } from "./store.mjs";
import { heat } from "./kiln.mjs";
export const start = () => heat() + " " + list();
