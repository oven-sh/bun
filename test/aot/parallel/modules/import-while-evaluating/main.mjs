// import() of a module that is being evaluated or is suspended: a module imports itself, its parent and its grandparent while they wait for it, with top-level await in each of the three, with an ancestor that throws afterwards, and a suspended module awaits import() of modules that import it, through helpers that hide who awaits the promise.
import { scenario } from "./events.mjs";

await scenario("no module awaits", () => import("./no-await/grandparent.mjs"));
await scenario("the child awaits after its imports", () => import("./child-awaits/grandparent.mjs"));
await scenario("the child awaits before its imports", () => import("./child-awaits-first/grandparent.mjs"));
await scenario("the parent awaits", () => import("./parent-awaits/grandparent.mjs"));
await scenario("the grandparent awaits", () => import("./grandparent-awaits/grandparent.mjs"));
await scenario("the parent throws", () => import("./parent-throws/grandparent.mjs"));
await scenario("the parent throws after its await", () => import("./parent-throws-after-await/grandparent.mjs"));
await scenario("the grandparent throws", () => import("./grandparent-throws/grandparent.mjs"));
await scenario("a suspended module awaits its importers", () => import("./awaited-through-helpers/suspended.mjs"));
