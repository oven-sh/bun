import { settings, copyOf } from "./settings.ts";
function level(): number { return settings.level + settings.extra; }
console.log(level(), JSON.stringify(copyOf()), Object.keys(settings).join());
