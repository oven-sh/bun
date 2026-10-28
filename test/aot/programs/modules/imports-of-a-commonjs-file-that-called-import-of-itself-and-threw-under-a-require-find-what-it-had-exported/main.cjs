// A required module requires a CommonJS file, which calls import() of itself and throws. Then the module calls import() of the file.
require("./module.mjs");
