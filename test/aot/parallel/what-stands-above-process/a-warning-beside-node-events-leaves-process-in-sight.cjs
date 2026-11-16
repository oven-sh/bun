// The price of the rule above is paid by who lays something, not by who warns: node:events itself calls process.emitWarning.
// STATISTIC: ImageFunctionsEmitted <= 600
require("node:events");
process.on("warning", warning => console.log("heard", warning.name, warning.message));
process.emitWarning("old", "DeprecationWarning");
