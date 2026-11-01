// Flags: --external outside-package
const outside = require("outside-package");
outside.show("asked later");
Bun.gc(true);
outside.show("after a collection");
