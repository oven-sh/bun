// calls-with-surplus-arguments-sloppy.cjs in a build that checks itself while it runs: an array that lies in a frame stops the program where it reaches anything but a read. The output is that of plain Bun.
require("./calls-with-surplus-arguments-sloppy.cjs");
