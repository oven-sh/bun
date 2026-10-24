// "bun:wrap" by a name computed at run time is the module that is compiled with the program: one namespace, one state, nothing interpreted.
import * as written from "bun:wrap";
import { createRequire } from "node:module";
const name = "bun:" + ["wr", "ap"].join("");
const imported = await import(name), again = await import(name), literal = await import("bun:wrap");
const required = import.meta.require(name), created = createRequire(import.meta.url)(name);
const say = (what, ...values) => console.log(what + ":", values.join(" "));
say("one namespace", written === imported, imported === again, written === literal, written === required, required === created);
say("one helper", written.__toESM === imported.__toESM, written.__toESM === required.__toESM);
const object = { a: 1 };
say("one state", written.__toESM(object) === imported.__toESM(object), written.__toESM(object) === required.__toESM(object));
say("what they are", ...[written, imported, required].map(it => Object.prototype.toString.call(it) + (Object.isExtensible(it) ? " extensible" : " sealed")));
say("the same names", Object.keys(written).join() === Object.keys(imported).join(), Object.keys(written).join() === Object.keys(required).join(), Object.keys(written).length > 30);
say("in require.cache", Object.keys(createRequire(import.meta.url).cache).filter(key => /^bun:wrap$|prelude/.test(key)).join());
