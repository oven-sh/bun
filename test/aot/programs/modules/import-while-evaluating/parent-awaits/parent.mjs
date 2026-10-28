import { ran } from "../events.mjs";
import "./child.mjs";
export let finished = false;
ran("parent starts");
await null;
ran("parent ends");
finished = true;
