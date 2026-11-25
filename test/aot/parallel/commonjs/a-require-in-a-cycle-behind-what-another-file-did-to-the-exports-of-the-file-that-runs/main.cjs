// below.cjs defines a getter on the module object of lib.cjs, which required it and whose body is still under way, and requires lib.cjs: the getter is asked, once a require().
console.log("main", require("./lib.cjs").a, require("./lib.cjs").a);
