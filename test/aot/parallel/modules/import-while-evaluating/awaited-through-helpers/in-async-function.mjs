import { ran } from "../events.mjs";
import { stage } from "./suspended.mjs";
ran("in-async-function sees stage " + stage);
export const seen = stage;
