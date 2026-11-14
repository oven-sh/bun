log("outer<");
keep("outer-late", import("./late.mjs"));
log("inner:" + inner());
keep("outer-outer", import("./outer.mjs"));
log("outer>");
