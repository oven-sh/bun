// The early CommonJS file does not require the JSON file itself; a file that it requires does. One of the imports is an ES module, and the JSON file holds an object whose keys are imported by name.
require("./middle.cjs");
