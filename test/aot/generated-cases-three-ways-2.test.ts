import { madeCases } from "./three-ways/made-cases";

madeCases("int32-read-once-used-twice");
madeCases("buffer-statics-partial-objects-host-records", { without: ["response-json-of-records"] });
madeCases("equality-and-builtins-in-variables");
madeCases("for-in-of-any");
madeCases("module-forms-of-typescript");
madeCases("removable-allocations");
madeCases("random-commonjs-and-esm-with-hooks", { seeds: 30 });
madeCases("reflect-construct-other-new-target");
madeCases("pure-module-symbols");
madeCases("typed-objects-as-host-options");
madeCases("direct-eval-visibility");
madeCases("interpreter-negative-caches");
