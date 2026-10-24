import { basename, isAbsolute, sep } from "node:path";
import { EventEmitter } from "node:events";
import { format, inspect } from "node:util";
import * as path from "node:path";
import * as posix from "node:path/posix";
import * as win32 from "node:path/win32";
import * as events from "node:events";

function separators(namespace) { return namespace.sep + namespace.delimiter; }
function absolute(namespace, text) { return namespace.isAbsolute(text); }
function missing(namespace) { return namespace.thereIsNoSuchExport; }
function stored(namespace) {
    try {
        namespace.sep = "!";
        return "stored";
    } catch (error) {
        return error.constructor.name;
    }
}

const texts = ["/usr/lib/x.js", "lib/y.ts", "C:\\z\\w.txt", ""];
const lines = [];
for (let round = 0; round < 16; round++) {
    const text = texts[round & 3];
    lines.push(format("%s %s %s", isAbsolute(text), basename(text), sep));
}
console.log(lines.join("\n"));

const namespaces = [path, posix, win32];
for (let round = 0; round < 12; round++) {
    const namespace = namespaces[round % 3];
    console.log(separators(namespace), absolute(namespace, texts[round & 3]), missing(namespace), stored(namespace), "sep" in namespace, typeof namespace.default);
}
for (let round = 0; round < 6; round++) console.log(missing(events), typeof events.EventEmitter, events.EventEmitter === EventEmitter, events.defaultMaxListeners, inspect(separators(path)));
