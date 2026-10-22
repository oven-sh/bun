// Ten modules of Node are imported, one is required, and a member of a few is asked for.
import fs from "node:fs";
import net from "node:net";
import zlib from "node:zlib";
import crypto from "node:crypto";
import child_process from "node:child_process";
import url from "node:url";
import path from "node:path";
import events from "node:events";
import stream from "node:stream";
import http from "node:http";
const util = require("node:util");

console.log(typeof fs, typeof net, typeof zlib, typeof crypto, typeof child_process);
console.log(typeof url, typeof path, typeof events, typeof stream, typeof http, typeof util);
console.log(path.join("a", "b"), typeof fs.existsSync, typeof util.inspect, typeof stream.Readable);
