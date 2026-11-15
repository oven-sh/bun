const real = require;
require = name => ({ one: "from the replacement for " + name });
const fake = require("./looked-at.mjs");
say("require is replaced:", fake.one);
require = real;
