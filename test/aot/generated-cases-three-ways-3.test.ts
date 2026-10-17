import { madeCases } from "./three-ways/made-cases";

madeCases("array-from-subclasses-and-native-setters");
madeCases("decorators");
madeCases("export-equals");
madeCases("exports-reached-from-inside");
madeCases("frozen-arrays-namespaces-out-of-bounds");
madeCases("modules-evaluated-again");
madeCases("one-string-every-representation");
madeCases("random-commonjs-and-esm", { seeds: 30 });
madeCases("sloppy-functions-bound-lazily");
madeCases("the-override-mistake");
madeCases("values-of-another-realm", { without: ["a-promise-of-another-realm"] });
madeCases("runtime-patching-tools");
