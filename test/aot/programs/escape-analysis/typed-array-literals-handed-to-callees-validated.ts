// typed-array-literals-handed-to-callees.ts in a build that checks itself while it runs: an array that lies in a frame stops the program where it reaches anything but a read. The output is that of plain Bun.
import "./typed-array-literals-handed-to-callees.ts";
