import { madeCases } from "./three-ways/made-cases";

madeCases("name-where-index-expected");
madeCases("arrays-iterators-and-sloppy-only-syntax");
madeCases("direct-eval-in-sloppy-commonjs");
madeCases("exports-reached-from-outside");
madeCases("hidden-builtin-subclasses");
madeCases("hooks-of-node-module");
madeCases("modules-failing-first-evaluation");
madeCases("operations-in-runtime-code");
madeCases("random-esm-namespace-as-value", { seeds: 30 });
madeCases("top-level-symbols", { without: ["a-worker-has-its-own"] });
madeCases("type-only-imports");
madeCases("surrounding-config-files");
madeCases("whole-numbers");
