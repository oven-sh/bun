// define-value-has-another-shape.ts in a build that checks itself while it runs: the place has the class that the program declares for the defined name, and holds an object without its fields. The output is that of plain Bun.
// Flags: --define NAME=target --aot-validate --aot-check=ClaimsToBackEnd
import "./define-value-has-another-shape.ts";
