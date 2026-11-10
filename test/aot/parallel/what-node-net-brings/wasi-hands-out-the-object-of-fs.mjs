import net from "node:net";
import { WASI } from "node:wasi";
const held = new WASI({}).bindings.fs;
const kept = held.fstatSync;
let seen = "not called";
held.fstatSync = function (fd) {
  seen = String(this === held);
  return kept(fd);
};
try {
  new net.Socket({ fd: +(process.argv[2] ?? 987), writable: true });
} catch (error) {
  console.log(seen, error.code);
}
