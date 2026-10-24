// Untyped programs: s diag2. It prints what plain Bun prints.
import dc from "node:diagnostics_channel";
const channel = dc.channel("x");
channel.subscribe((message: unknown) => { console.log("got"); });
channel.publish(1);
