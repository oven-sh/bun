import { ran } from "../events.mjs";
import { stage } from "./suspended.mjs";
ran("after-finally sees stage " + stage);
export const seen = stage;
