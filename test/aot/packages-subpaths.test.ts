import { cases } from "./packages/subpaths";
import { packages } from "./packages/run-packages";

packages("subpaths", cases, 1, 1, {"imports": {"#app/*": "./app/*.mjs", "#cfg": "./app/cfg.json", "#one": "./app/one.mjs", "#pk": "hash_dep"}});
