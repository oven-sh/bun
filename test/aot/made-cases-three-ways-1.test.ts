import { madeCases } from "./three-ways/made-cases";

madeCases("a-name-where-an-index-is-expected");
madeCases("arrays-iterators-and-what-only-sloppy-code-may-say");
madeCases("direct-eval-in-sloppy-commonjs");
madeCases("exports-reached-from-outside");
madeCases("heirs-of-built-ins-that-are-not-seen");
madeCases("hooks-of-node-module");
madeCases("modules-whose-first-evaluation-fails");
madeCases("operations-in-text-made-at-run-time");
madeCases("random-es-modules-whose-namespace-is-a-value", { seeds: 30 });
madeCases("symbols-at-the-top-of-a-module", { without: ["a-worker-has-its-own"] });
madeCases("type-only-imports");
madeCases("what-the-files-around-a-program-decide");
madeCases("whole-numbers");
