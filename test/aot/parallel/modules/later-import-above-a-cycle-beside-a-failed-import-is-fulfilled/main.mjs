// A cycle of five is evaluated by the first import(). The second import() fails above one member of it, and the third names another module above that member: it is fulfilled, as under `bun run`, and its body runs.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 4
for (const name of ["n1", "n2", "n3"]) {
  try { await ({ n1: () => import("./n1.mjs"), n2: () => import("./n2.mjs"), n3: () => import("./n3.mjs") })[name](); console.log("import of " + name + ": fulfilled"); } catch (e) { console.log("import of " + name + ": rejected,", e.message); }
}
