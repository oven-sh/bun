import * as whole from "./part.mjs";
import text from "./part.mjs" with { type: "text" };
export const user = () => [whole.o ?? whole.default?.o, text.length].join(":");
