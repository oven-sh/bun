import { bodies } from "./log.mjs";
import "./cycle-b.mjs";
bodies.push("cycle-a");
throw new Error("thrown by cycle-a");
