// The program has the stream classes, for it reads tty.ReadStream, and prints process.stdout.isTTY. The standard output answers each name
// by itself, so what is printed is not its write(), nobody calls that on a stream, and the whole standard stream stays out: 847 functions, not 1,819.
// STATISTIC: ImageFunctionsEmitted <= 1000
import tty from "node:tty";
console.log(typeof tty.ReadStream, process.stdout.isTTY);
