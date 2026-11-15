const native = Object.getPrototypeOf(process);
try { native.madeUp = function () { return "laid"; }; console.log("stored", process.madeUp()); } catch (error) { console.log(error.constructor.name, String(error.message).slice(0, 160)); }
