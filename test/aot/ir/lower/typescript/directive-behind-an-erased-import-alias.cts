// `bun run` erases `import type a = ..`, so the directive behind it is one.

// RUN: lower
// CHECK: function {{*}}name="strict"
// CHECK-NOT: IsSloppy
// CHECK: thisType=

import type Path = require("node:path");
"use strict";

export = function strict(this: unknown, path?: Path.ParsedPath) {
  return [this, path];
};
