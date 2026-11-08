import defer * as whole from "./early.mjs";
log("late<");
keep("late-first", import("./first.mjs"));
log("late:" + whole.name);
export const name = "late";
log("late>");
