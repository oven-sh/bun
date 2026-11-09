import * as b from "bun-builtins-table";
import { globSync } from "node:fs";
import { basename, resolve } from "node:path";

// Every build has the same table, so it has nothing of a schema that only some builds compile (isCompiled() in scripts/build/codegen.ts):
// a `*_test.bind.ts` binds what exists for tests, in a build with assertions, and src/runtime/webgpu is in a build with `--webgpu=on`.
const schemasOfSomeBuilds = globSync(["src/**/*_test.bind.ts", "src/runtime/webgpu/*.bind.ts"], {
  cwd: resolve(import.meta.dir, "..", "..", "..", ".."),
});

export default b.declarations(b.leftOut({ schemas: schemasOfSomeBuilds.map(schema => basename(schema)).sort() }));
