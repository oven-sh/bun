import { ran } from "../events.mjs";
import { stage } from "./suspended.mjs";
ran("in-promise-all sees stage " + stage);
export const seen = stage;
