import conf from "./conf.toml" with { type: "text" };
export function seen() { switch (conf) { case "port = 21\n": return "the text"; case undefined: return "nothing"; default: return "something else: " + typeof conf; } }
