// The program uses the module too, in a line that never runs.
const decoded = text => Buffer.from(text).toString(); // text that is decoded at run time is unknown to the compiler
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const never = process.argv.length > 99;
const say = async f => { let answer; try { answer = await f(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); } console.log(answer); };
if (never) console.log((await import("node:zlib")).gzipSync("x"));
say(async () => new Function("require", decoded("try { return typeof require('node:zlib').gzipSync; } catch { return 'fell back'; }"))((await import("node:module")).createRequire(import.meta.url)));
