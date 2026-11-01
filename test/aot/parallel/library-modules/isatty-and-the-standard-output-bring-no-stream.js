// Color detection asks node:tty whether a descriptor is a terminal, and process.stdout whether it is one. Neither loads a stream:
// tty.ReadStream is put below fs.ReadStream when it is first read.
// STATISTIC: ImageFunctionsEmitted <= 300
import tty from "node:tty";
console.log(tty.isatty(1), process.stdout.isTTY);
