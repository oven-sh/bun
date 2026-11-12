import { createRequire } from "node:module";
const CANDIDATES = ["../gauge-info.json", "./gauge-info.json"];
function read(moduleUrl, candidates) {
  try {
    const require = createRequire(moduleUrl);
    for (const candidate of candidates)
      try {
        const parsed = require(candidate);
        if (parsed.version) return parsed.version;
      } catch {}
    return null;
  } catch {
    return null;
  }
}
console.log("SAID", read(import.meta.url, CANDIDATES) || "0.0.0");
