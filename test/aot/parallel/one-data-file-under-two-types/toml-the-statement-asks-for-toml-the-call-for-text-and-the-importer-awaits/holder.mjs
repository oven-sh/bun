import conf from "./conf.toml" with { type: "toml" };
await 0;
export const seen = typeof conf + ":" + JSON.stringify(conf);
