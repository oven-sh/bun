// reader.mjs and caller.mjs import each other, so caller.mjs runs first and calls a function of reader.mjs that reads data.json, whose turn has not come. What a JSON file exports is there once the graph is loaded.
import "./reader.mjs";
