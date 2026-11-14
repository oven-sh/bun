// A rest in the pattern, a computed key, and a second use of the call's value are more than names.
const net = require("node:net");
const probe = (road, fs) => {
  const kept = fs.fstatSync;
  fs.fstatSync = function (fd) {
    console.log(road, fd, this === fs);
    return kept(fd);
  };
  try {
    new net.Socket({ fd: 987, writable: true });
  } catch (error) {
    console.log(error.code);
  }
  fs.fstatSync = kept;
};
const { existsSync, ...rest } = require("node:fs");
console.log(typeof existsSync, typeof rest.fstatSync);
const { existsSync: second } = (globalThis.held = require("node:fs"));
probe("held on the way into a pattern", globalThis.held);
const [whole] = [require("node:fs")];
probe("out of a list", whole);
console.log(typeof second);
