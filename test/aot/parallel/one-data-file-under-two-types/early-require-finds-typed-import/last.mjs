import { read } from "./reader.cjs";
import settings from "./settings.toml" with { type: "toml" };
export const early = read(["./data", "json"].join(".")) + " " + settings.port;
