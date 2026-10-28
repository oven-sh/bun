// The module that evaluated text loads is named in a method of a class that is never constructed.
const decoded = text => Buffer.from(text).toString(); // text that is decoded at run time is unknown to the compiler
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const never = process.argv.length > 99;
const say = async f => { let answer; try { answer = await f(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); } console.log(answer); };
class Plain { run() { return 1; } }
class Packed { run() { return import("node:zlib").then(z => z.gzipSync("x")); } }
const codec = new Plain(); codec.run();
if (never) console.log(Packed.name);
say(async () => (await new Function(decoded("return import(\x27node:zlib\x27)"))()).gzipSync("abc").length > 0);
