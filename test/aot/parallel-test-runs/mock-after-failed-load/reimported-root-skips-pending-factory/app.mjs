import { heat } from "./kiln.mjs";
import { list } from "./store.mjs";
export const start = () => heat() + " " + list();
