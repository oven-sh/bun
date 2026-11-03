// console.Console is the class that a function of the library makes at the first read: an instance writes to the streams that it was given, and a method that only it calls is in the program.
import { Console } from "node:console";
import { Writable } from "node:stream";
class Collected extends Writable {
  text = "";
  _write(chunk: Buffer, _encoding: string, done: () => void) { this.text += chunk.toString(); done(); }
}
const out = new Collected(), err = new Collected();
const mine = new Console(out, err);
mine.log("to %s", "out", { a: 1 }); mine.error("to err"); mine.warn([1, 2]); mine.info(new Map([[1, 2]]));
mine.group("group"); mine.log("indented"); mine.groupEnd(); mine.table([{ a: 1 }]); mine.count(); mine.assert(false, "asserted");
console.log(JSON.stringify(out.text), JSON.stringify(err.text));
console.log(Console === console.Console, console.Console === console.Console, mine instanceof Console, typeof Console, Console.name, require("node:console") === console, console instanceof Console);
const withOptions = new console.Console({ stdout: out, stderr: err, colorMode: false, inspectOptions: { depth: 0 } });
out.text = ""; withOptions.log({ deep: { deeper: 1 } }); console.log(JSON.stringify(out.text));
try { new Console({} as any); } catch (e) { console.log((e as any).code); }
console.log((console as any)._stdout === process.stdout, (console as any)._stderr === process.stderr, typeof (console as any)._stdout.write, Object.getOwnPropertyDescriptor(console, "_stdout")!.enumerable, "value" in Object.getOwnPropertyDescriptor(console, "Console")!);
