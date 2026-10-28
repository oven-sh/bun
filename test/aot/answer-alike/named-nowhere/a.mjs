// Evaluated text loads a module that the source names nowhere.
const decoded = text => Buffer.from(text).toString(); // text that is decoded at run time is unknown to the compiler
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const never = process.argv.length > 99;
const say = async f => { let answer; try { answer = await f(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); } console.log(answer); };
say(async () => (await new Function(decoded("return import(\x27node:zlib\x27)"))()).gzipSync("abc").length > 0);
