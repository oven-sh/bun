import { read } from "./reader.cjs";
export const early = read(JSON.parse('"./settings.toml"'));
