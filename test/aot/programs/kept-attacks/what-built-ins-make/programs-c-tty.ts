// What built ins make: programs c tty. It prints what plain Bun prints.
import tty from "node:tty";
console.log(tty.isatty(0), tty.isatty(1), tty.isatty(99), tty.isatty("x" as any), (tty.isatty as any)());
console.log(typeof tty.ReadStream, typeof tty.WriteStream, process.stdout.isTTY, process.stdin.isTTY);
try { new tty.WriteStream(-1); } catch (e) { console.log((e as any).code, (e as Error).name); }
try { console.log(new tty.WriteStream(1).getWindowSize()); } catch (e) { console.log((e as any).code, (e as Error).message); }
