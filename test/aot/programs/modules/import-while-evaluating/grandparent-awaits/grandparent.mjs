import { ran } from "../events.mjs";
import "./parent.mjs";
export let finished = false;
ran("grandparent starts");
await null;
ran("grandparent ends");
finished = true;
