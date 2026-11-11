import { heat } from "./kiln.mjs";
import { region } from "./store.mjs";
export const start = () => heat() + " " + "list " + region();
