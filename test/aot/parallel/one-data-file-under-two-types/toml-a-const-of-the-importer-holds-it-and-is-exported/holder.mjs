import { kept, isText } from "./between.mjs";
export const seen = [isText ? "text" : "data", typeof kept === "string" ? kept.length : kept.port].join();
