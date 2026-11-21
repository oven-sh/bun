// An import of "default" from a file marked as compiled from ES modules is the whole object once another file has deleted the property.
require("./lose.cjs");
require("./read.mjs");
