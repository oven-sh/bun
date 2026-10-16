import { madeCases } from "./three-ways/made-cases";

madeCases("a-word-read-once-and-used-twice");
madeCases("buffer-statics-half-made-objects-and-records-handed-to-the-host", { without: ["response-json-of-records"] });
madeCases("equality-and-built-ins-kept-in-variables");
madeCases("for-in-of-any");
madeCases("module-forms-of-typescript");
madeCases("objects-that-need-not-be-made");
madeCases("random-commonjs-and-es-modules-with-hooks", { seeds: 30 });
madeCases("reflect-construct-with-another-new-target");
madeCases("symbols-of-modules-that-only-make-values");
madeCases("typed-objects-as-options-of-the-host");
madeCases("what-a-direct-eval-sees");
madeCases("what-the-interpreter-remembers-as-not-there");
