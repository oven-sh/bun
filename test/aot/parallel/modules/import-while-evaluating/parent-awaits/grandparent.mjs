import { ran } from "../events.mjs";
import "./parent.mjs";
export let finished = false;
ran("grandparent starts");
ran("grandparent ends");
finished = true;
