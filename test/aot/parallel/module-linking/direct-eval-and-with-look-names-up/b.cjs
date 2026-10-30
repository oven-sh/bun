var shared = "b"; function helper() { return "helper b"; } with ({ shared: "from with" }) { exports.w = [shared, helper()]; } exports.b = [eval("shared"), (0, eval)("typeof shared")];
