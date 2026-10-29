import { ran } from "../events.mjs";
import { stage } from "./suspended.mjs";
ran("after-then sees stage " + stage);
export const seen = stage;
