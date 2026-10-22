// A package marked --external is interpreted, and so is a module of Bun's library that it loads and that the executable does not hold. Such a module requires others that the executable does
// hold, compiled: node:dgram asks internal/validators for functions that the program itself never calls.
import take from "outside";
for (const name of ["node:zlib", "node:dgram", "node:readline", "bun:sqlite", "node:path"]) {
  try {
    const whole = take(name);
    console.log(name, typeof whole, Object.keys(whole).length > 3);
  } catch (error) {
    console.log(name, "threw", error.message);
  }
}
console.log(take("node:zlib").gzipSync("a").length > 5);
const socket = take("node:dgram").createSocket("udp4");
console.log(typeof socket.bind);
socket.close();
