import conf from "./conf.toml" with { type: "text" };
export const seen = typeof conf === "string" ? conf.length : conf.port;
