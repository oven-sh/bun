import "./prints.mjs";
import { held } from "./lists.mjs";
import net from "node:net";
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
