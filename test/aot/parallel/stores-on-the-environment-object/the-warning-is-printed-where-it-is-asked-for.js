// The listener of the program hears the warning of the host: what emits it is in the build wherever such a value may be stored.
process.on("warning", warning => console.log("heard:", warning.name, warning.code));
process.env.MADE_UP_TEXT = "quiet";
process.env.MADE_UP_VALUE = Symbol.iterator.description === "Symbol.iterator" ? undefined : "never";
setTimeout(() => console.log("done", process.env.MADE_UP_TEXT, process.env.MADE_UP_VALUE), 10);
