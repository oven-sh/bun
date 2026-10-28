console.log("required: id", module.id === "." ? "." : require("node:path").basename(module.id));
