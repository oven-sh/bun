// ReadStream of node:tty is a value like the others, and stands below ReadStream of node:fs from the start.
import fs from "node:fs";
import tty from "node:tty";
for (const name of Object.keys(tty)) {
  const { value, ...rest } = Object.getOwnPropertyDescriptor(tty, name);
  console.log(name, typeof value, JSON.stringify(rest));
}
console.log(Object.getPrototypeOf(tty.ReadStream) === fs.ReadStream, tty.ReadStream.name);
