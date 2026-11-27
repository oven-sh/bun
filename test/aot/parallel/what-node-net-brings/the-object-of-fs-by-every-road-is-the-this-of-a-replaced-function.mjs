// Every road by which a program comes to hold the object of node:fs: a function laid on it is called on it.
import { createRequire } from "node:module";
import * as space from "node:fs";
import { default as named } from "node:fs";
import net from "node:net";
const roads = {
  "a namespace's default": space.default,
  "the name default": named,
  "import()": (await import("node:fs")).default,
  "a made require": createRequire(import.meta.url)("fs"),
  "process.getBuiltinModule": process.getBuiltinModule("node:fs"),
};
for (const [road, fs] of Object.entries(roads)) {
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
}
