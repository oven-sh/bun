import { ran } from "../events.mjs";
import { stage } from "./suspended.mjs";
ran("directly sees stage " + stage);
export const seen = stage;
