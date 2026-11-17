const seen = require("./looked-at.mjs");
say("text sees the constant:", eval("typeof seen + ' ' + seen.two"), seen.one);
