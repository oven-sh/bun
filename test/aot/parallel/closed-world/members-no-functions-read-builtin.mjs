// Four built-in modules come out of the get trap of a Proxy and out of a reviver. The program walks their keys and prints the kind of every member that is no function.
import fs from "node:fs";
import http from "node:http";
import timers from "node:timers";
import tls from "node:tls";

const modules = { fs, http, timers, tls };
for (const name in modules) {
  for (const handed of [new Proxy({}, { get: () => modules[name] }).anything, JSON.parse("[0]", () => modules[name])]) {
    const seen = [];
    for (const key in handed) {
      const value = handed[key];
      if (typeof value !== "function") seen.push(key + "=" + (value === null ? "null" : typeof value));
    }
    console.log(name, seen.length, seen.join(" "));
  }
}
