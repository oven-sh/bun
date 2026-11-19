// What the program lays under process.platform does not choose how the printer of warnings takes the name of the program apart.
// Env: NODE_REDIRECT_WARNINGS=/dev/stdout
Object.defineProperty(process, "pid", { value: 1 });
Object.defineProperty(process, "platform", { value: process.platform === "win32" ? "linux" : "win32" });
process.argv0 = "left\\right";
process.emitWarning("made up");
