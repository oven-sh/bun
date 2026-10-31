// calls-with-surplus-arguments.js in a build that checks itself while it runs: an array that lies in a frame stops the program where it reaches anything but a read. The output is that of plain Bun.
// Flags: --aot-validate --aot-disable=InlineCalls
import "./calls-with-surplus-arguments.js";
