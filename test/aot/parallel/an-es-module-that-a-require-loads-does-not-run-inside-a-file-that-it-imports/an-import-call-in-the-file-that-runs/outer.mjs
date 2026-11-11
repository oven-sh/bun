import starter from "./starter.cjs";
export const value = starter.starter + import.meta.require("./inner.mjs").value;
