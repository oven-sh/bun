// The modules that a chunk of a split bundle wraps run as in plain Bun, with wrappers that another chunk defines.
// STATISTIC: RequireSitesBound >= 8
import { log, require_shared, viaDeclaration } from "./chunk.mjs";
console.log(viaDeclaration(), require_shared() === require_shared(), require_shared().leaf.name);
console.log(log.join(" "));
