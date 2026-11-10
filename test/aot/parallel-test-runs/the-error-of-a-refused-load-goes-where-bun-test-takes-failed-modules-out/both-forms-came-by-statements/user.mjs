import { part } from "./part.mjs";
import text from "./part.mjs" with { type: "text" };
export const user = () => [part, text.length].join(":");
