// Until it is first read tty.ReadStream is an accessor. A store in front of the first read makes it a plain member, and nothing is set up.
const tty = require("node:tty");
const before = Object.getOwnPropertyDescriptor(tty, "ReadStream");
console.log(typeof before.get, typeof before.set, before.enumerable, before.configurable, Object.keys(tty).join());
tty.ReadStream = function Other() {};
const { value, ...rest } = Object.getOwnPropertyDescriptor(tty, "ReadStream");
console.log(tty.ReadStream.name, value === tty.ReadStream, JSON.stringify(rest), Object.keys(tty).join());
