import { describe, described, reset, settings, type Settings } from "ships-typescript";
function next(target: Settings): number { return "retries" in target ? target.retries + 1 : -1; }
const full: Settings = { retries: 2 };
console.log(described, describe(settings), describe(full), describe({}), next(settings), next(full), next({}));
reset(full);
console.log(describe(full), next(full));
