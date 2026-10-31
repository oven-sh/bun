const path = require("node:path");
delete path.sep;
delete path.basename;
delete require("node:os").EOL;
