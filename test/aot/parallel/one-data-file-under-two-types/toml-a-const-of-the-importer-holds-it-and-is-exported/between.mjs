import conf from "./conf.toml" with { type: "text" };
export const kept = conf;
export const isText = typeof conf === "string";
