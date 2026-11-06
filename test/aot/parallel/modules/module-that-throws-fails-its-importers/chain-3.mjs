import { bodies } from "./log.mjs";
import "./sibling-3.mjs";
import "./chain-4.mjs";
bodies.push("chain-3");
throw new Error("thrown by chain-3");
