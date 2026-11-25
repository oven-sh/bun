import { createRequire } from "node:module";
const CRATE_CANDIDATES = ["../crate.json", "../../crate.json", "./crate.json"];
const INFO_CANDIDATES = ["../gauge-info.json", "../../gauge-info.json", "./gauge-info.json"];
function readFromCandidates(moduleUrl, candidates, opts = {}) {
  try {
    const require = createRequire(moduleUrl);
    for (const candidate of candidates)
      try {
        const parsed = require(candidate);
        const gauge = typeof parsed.version === "string" ? parsed.version.trim() : "";
        if (!gauge) continue;
        if (opts.requireName && parsed.name !== "made-up") continue;
        return gauge;
      } catch {}
    return null;
  } catch {
    return null;
  }
}
function readFromCrate(moduleUrl) {
  return readFromCandidates(moduleUrl, CRATE_CANDIDATES, { requireName: true });
}
function readFromInfo(moduleUrl) {
  return readFromCandidates(moduleUrl, INFO_CANDIDATES);
}
function resolveFromUrl(moduleUrl) {
  return readFromInfo(moduleUrl) || readFromCrate(moduleUrl);
}
function resolveGauge(params) {
  return resolveFromUrl(params.moduleUrl) || params.fallback || "0.0.0";
}
const GAUGE = resolveGauge({ moduleUrl: import.meta.url, bundled: process.env.MADE_UP });
export { resolveGauge as a, resolveFromUrl as d, readFromCrate as i, readFromInfo as r, GAUGE as t };
