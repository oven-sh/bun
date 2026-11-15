import * as b from "bun-builtins-table";
import { globSync } from "node:fs";
import { basename, resolve } from "node:path";

// A `*_test.bind.ts` binds what exists for tests. Only a build with assertions compiles it (isCompiled() in scripts/build/codegen.ts), and
// every build has the same table.
const schemasForTests = globSync("src/**/*_test.bind.ts", { cwd: resolve(import.meta.dir, "..", "..", "..", "..") });

export default b.declarations(b.leftOut({ schemas: schemasForTests.map(schema => basename(schema)).sort() }));
