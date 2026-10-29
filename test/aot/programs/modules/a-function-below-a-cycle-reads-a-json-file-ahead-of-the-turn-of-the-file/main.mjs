// hub.mjs and caller.mjs import each other. caller.mjs calls a function that hub.mjs passes on from reader.mjs, which is on no cycle and has not run, and the function reads data.json.
import "./hub.mjs";
