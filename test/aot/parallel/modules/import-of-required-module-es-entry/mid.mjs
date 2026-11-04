import "./a.mjs";
export let value = "early";
require("./b.mjs");
value = "late";
