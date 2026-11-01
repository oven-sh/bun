import { ran } from "../events.mjs";
import "./child.mjs";
export let finished = false;
ran("parent starts");
await null;
throw new Error("thrown by the parent after its await");
