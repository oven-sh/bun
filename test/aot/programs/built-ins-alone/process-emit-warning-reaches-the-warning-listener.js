process.on("warning", warning => console.log(warning instanceof Error, warning.name, warning.message.length));
process.emitWarning("careful");
