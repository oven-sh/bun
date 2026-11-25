import it from "node:fs";
import * as all from "node:fs";
import { existsSync } from "node:fs";
export const seen = () => [it.existsSync("/nowhere"), all.existsSync("/nowhere"), existsSync("/nowhere"), Object.keys(all).length > 5 ? "the keys of the module" : Object.keys(all).join("+")].join();
