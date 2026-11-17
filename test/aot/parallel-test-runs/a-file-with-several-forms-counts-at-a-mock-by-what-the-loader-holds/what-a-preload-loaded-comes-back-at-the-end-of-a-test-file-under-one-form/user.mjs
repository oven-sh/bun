import * as whole from "./bin.json";
import text from "./bin.json" with { type: "text" };
export const user = () => [whole.o ?? whole.default?.o, text.length].join(":");
