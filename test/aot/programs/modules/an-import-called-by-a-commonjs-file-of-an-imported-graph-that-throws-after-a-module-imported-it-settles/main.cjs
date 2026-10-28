// As its neighbor without "of an imported graph", but the files are imported by a module that the entry point loads with import().
require("./lines.cjs");
track("root", import("./root.mjs"));
