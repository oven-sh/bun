// define-value-is-narrowed.ts in a build that checks itself while it runs: each read of the defined name is a read of the parameter, also behind a test that has narrowed the type of the name. The output is that of plain Bun.
// Flags: --define NAME=target --aot-validate --aot-check=ClaimsToBackEnd
import "./define-value-is-narrowed.ts";
