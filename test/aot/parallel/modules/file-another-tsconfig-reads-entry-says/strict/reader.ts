import * as entryPoint from "../main.ts";
import { IS_MAIN, IS_NOT_MAIN, IS_REQUIRED_FIRST, KIND, pick } from "../main.ts";

export function describe(): string {
  const branches = [IS_MAIN ? "main" : "not main", IS_NOT_MAIN ? "not main" : "main", IS_REQUIRED_FIRST ? "first" : "not first"];
  if (!entryPoint.IS_MAIN) branches.push("not main by the namespace");
  return [...branches, KIND, entryPoint.KIND, pick(), import.meta.main, require.main === module].join(", ");
}
