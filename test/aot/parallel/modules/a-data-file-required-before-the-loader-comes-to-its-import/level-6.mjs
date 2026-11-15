import config from "./config.json";
import list from "./list.json";
import settings from "./settings.toml";
import defaults from "settings-of-a-package/defaults.json";
import { port } from "./read-by-name.json";
import inner from "./inner.json";
console.log("imported:", config.host, list.length, settings.host, defaults.host, port, inner.host);
