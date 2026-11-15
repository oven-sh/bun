// A tool walks from an object along every edge and stops where an edge enters a scope of a loaded module. It meets each function once, at that edge, and nothing that a function captures.
import { makeCounter, makeLogger, makeBound, touchesNothing } from "./makers";
import { walkUpToScopes } from "./walk";
(globalThis as any).keptForTheWalk = { mark_of_the_start: { counter: makeCounter(), logger: makeLogger(), bound: makeBound(), touchesNothing } };
for (const line of walkUpToScopes("mark_of_the_start")) console.log(line);
