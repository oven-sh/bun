const laid = String(module.laid);
module.seen = "by the other file";
Object.defineProperty(module, "exports", { enumerable: true, get: () => ({ laid }) });
