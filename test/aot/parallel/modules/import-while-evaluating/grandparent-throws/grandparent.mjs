import { ran } from "../events.mjs";
import "./parent.mjs";
export let finished = false;
ran("grandparent starts");
throw new Error("thrown by the grandparent");
