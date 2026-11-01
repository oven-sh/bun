// A cycle of three, in which one member has no status of its own, fails while the first import() evaluates it. A second import() names a module that imports a member whose body has ended: it is rejected with the error of the cycle, as under `bun run`.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 1
try { await import("./a.mjs"); console.log("import of a: fulfilled"); } catch (e) { console.log("import of a: rejected,", e.message); }
try { await import("./b.mjs"); console.log("import of b: fulfilled"); } catch (e) { console.log("import of b: rejected,", e.message); }
