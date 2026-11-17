import conf from "./conf.json5" with { type: "json5" };
export const seen = typeof conf === "string" ? conf.length : conf.port;
