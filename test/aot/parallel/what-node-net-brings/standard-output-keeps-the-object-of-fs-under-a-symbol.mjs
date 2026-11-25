import net from "node:net";
const key = Reflect.ownKeys(process.stdout).find(it => typeof it === "symbol" && it.description === "kFs");
const held = key ? process.stdout[key] : (console.log("no such key"), process.exit(0));

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
