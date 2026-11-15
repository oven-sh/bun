import conf from "./conf.toml" with { type: "toml" };
export const port = typeof conf === "string" ? conf.length : conf.port;
