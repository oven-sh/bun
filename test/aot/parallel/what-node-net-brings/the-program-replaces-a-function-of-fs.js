// The function is read off node:fs at each call: what the program has laid there is what runs.
const net = require("node:net");
const fs = require("node:fs");
const kept = fs.fstatSync;
fs.fstatSync = function (fd) {
  console.log("asked", fd);
  return kept(fd);
};
try {
  new net.Socket({ fd: 987, writable: true });
} catch (error) {
  console.log(error.code);
}
