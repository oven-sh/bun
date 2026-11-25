// Color detection asks node:tty whether a descriptor is a terminal, and process.stdout whether it is one. process.stdout loads no stream for that.
// node:tty loads the streams of files while it loads, as in plain Bun: what those keep of node:fs they keep as it stands then.
// STATISTIC: ImageFunctionsEmitted <= 300 Todo: what this program reaches of Bun's library is not cut down to what it uses yet
import tty from "node:tty";
console.log(tty.isatty(1), process.stdout.isTTY);
