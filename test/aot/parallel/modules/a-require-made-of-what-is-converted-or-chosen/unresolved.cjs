const { show } = require("./show.cjs");
show("a name that only the other base has", () => require("module").createRequire("http://" + __filename)("./nowhere.cjs"));
