# Rework plan after the self-review (run 7ae682cdf1ee, verdict: rework, wanted-in-a-different-shape 0.72)

Branch before rework: robobun/cd14648e/process-events-emitter @ 3916caabd7 (builtins design, one commit on main 4b02e1031d).

Review findings to address:
1. `--compile --bytecode`: builtin functions get no embedded bytecode (#40794 embeds internal MODULES only), so first
   emitter use there goes 0.39M -> 1.67M instructions and 6 -> 18 source parses. Fix: the methods live in an internal
   module (`internal/events/prototype`), not in builtins. Also removes: 10 builtin names, addBuiltinGlobal/builtinGlobal,
   createEmit factory, the two ZigGlobalObject fields (REVIEW.md: no new fields on ZigGlobalObject, no new cross-cutting
   abstraction in a feature PR).
2. Outcomes that are neither main's nor node's:
   a. `bun test` + a throwing 'exit' listener ahead of one that sets the exit code: main 1, branch 0, node 1.
      Needs the change of #41588 (test_command.rs: unhandled_error_counter before/after on_exit -> exit code 1).
   b. Worker: the 'exit' listeners after a throwing one are skipped and nothing is reported.
   c. Document (not fix): MaxListenersExceededWarning under `bun --hot` / `bun test`, `native` frames (gone with modules).
3. #12918 (also #29194, #32227): runtime emits must call a replaced `process.emit`. Approach of #32228 (e2ae14facd)
   for all runtime emits: replaced and callable -> call it, also with zero listeners.
4. Packaging: PR A = refactor (methods module + native lazy prototype, no behaviour change), PR B = process switch.
   Related open PRs to name: #41830, #41599, #41588, #42032, #32228, #36322, #42575, #35801, #35823, #42031, #35388.
   Issue this fixes: #44170 (listeners after a throwing one still run). Related: #44018 (exit code).

Native shape for the module design:
- NodeEventEmitterPrototype.cpp: JSNonFinalObject with lazy static table, every entry a PropertyCallback that reads
  the function from requireId(InternalEventsPrototype) (constructor: requireId(NodeEvents); _eventsCount: 0).
- Process keeps the prototype and the two symbols (kShapeMode, kCapture) in its own fields; node:events gets them
  through $cpp bindings. No ZigGlobalObject fields, no builtin names.
- Process::createStructure sets setHasAnyKindOfGetterSetterPropertiesWithProtoCheck(false) (lut generator bug handed off).

Measurements to redo with the final binary: hot 4 tiers, cold, first.js/parts.js intervals, startup functions (ifunc),
bytecode-mode app (app-events.js / app-process.js with --compile --bytecode), size.
