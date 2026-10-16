import { madeCases } from "./three-ways/made-cases";

madeCases("array-from-heirs-of-array-and-native-setters");
madeCases("decorators");
madeCases("export-equals");
madeCases("exports-reached-from-inside");
madeCases("frozen-arrays-namespaces-and-reads-past-the-end");
madeCases("modules-evaluated-again");
madeCases("one-text-in-every-form-a-string-can-have");
madeCases("random-commonjs-and-es-modules", { seeds: 30 });
madeCases("sloppy-functions-bound-on-first-use");
madeCases("the-override-mistake");
madeCases("values-of-another-realm", { without: ["a-promise-of-another-realm"] });
madeCases("what-tools-patch-at-run-time");
