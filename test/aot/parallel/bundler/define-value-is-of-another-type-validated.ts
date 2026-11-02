// define-value-has-another-type.ts in a build that checks itself while it runs: the place has the type that the program declares for the defined name, and holds what the parameter holds. The output is that of plain Bun.
// Flags: --define NAME=target --aot-validate --aot-check=ClaimsToBackEnd
import "./define-value-has-another-type.ts";
