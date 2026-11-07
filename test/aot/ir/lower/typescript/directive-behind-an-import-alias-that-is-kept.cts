// `import a = ..` is a statement of the code, whether or not anything reads the name, so no directive stands behind it.

// RUN: lower
// CHECK: function {{*}}name="sloppy"{{*}}flags=[IsSloppy

import Path = require("node:path");
"use strict";

export = function sloppy(this: unknown, path?: Path.ParsedPath) {
  return [this, path];
};
