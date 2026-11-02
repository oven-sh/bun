// What an ES module binds of one of Bun's own modules: the own names that can be listed, as they are when the module is first imported, and the module itself as `default`. A name stored later
// is not seen by a binding nor by a namespace object that is asked for later; the default export is the object itself, which shows it.
import path, { join, sep, posix } from "node:path";
import os, { EOL } from "node:os";
import util, { format, inspect } from "node:util";
import events, { EventEmitter, once } from "node:events";
import querystring, { stringify } from "node:querystring";
import assert, { strictEqual } from "node:assert";
import * as pathNames from "node:path";
console.log(join("a", "b"), sep, posix.sep, path.join === join, typeof path.default);
console.log(JSON.stringify(EOL), os.EOL === EOL, format("%s-%d", "x", 1), util.inspect === inspect);
console.log(typeof EventEmitter, events === EventEmitter, typeof once, stringify({ a: 1 }), querystring.stringify === stringify, typeof assert, typeof strictEqual);
console.log(Object.keys(pathNames).join(), pathNames.default === path);
path.addedLater = 1;
const original = querystring.stringify;
querystring.stringify = () => "replaced";
console.log(stringify({ b: 2 }), querystring.stringify({ b: 2 }), "addedLater" in pathNames, "addedLater" in (await import("node:path")), (await import("node:querystring")).stringify === original);
