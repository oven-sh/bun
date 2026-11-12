import conf from "./conf.toml" with { type: "text" };
export const seen = typeof conf === "string" ? (await import("./for-text.mjs")).which : (await import("./for-data.mjs")).which;
