import * as outer from "./outer.js";
export const seen = () => ["first", "second", "third", "added", "own"].map(key => key + "=" + outer[key]).join(" ") + " keys=" + Object.keys(outer).sort().join("+");
