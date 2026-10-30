import { ran } from "../events.mjs";
import "./child.mjs";
export let finished = false;
ran("parent starts");
ran("parent ends");
finished = true;
