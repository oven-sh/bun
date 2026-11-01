// The namespace object of one file and the import() of another are written in arms that no value ever takes: what is parsed from a text is never undefined. Both arms are compiled all the same.
// Flags: --aot-check=verify-each-pass
import * as named from "./namespace-named-in-arm-that-never-runs/named.ts";
function pick(given: any) {
  const kind: string | undefined = given;
  return kind === undefined ? named : kind;
}
async function load(given: any) {
  const kind: string | undefined = given;
  return kind === undefined ? await import("./namespace-named-in-arm-that-never-runs/loaded.ts") : kind;
}
console.log(pick(JSON.parse('"x"')), await load(JSON.parse('"y"')), named.one);
