// Evaluated text asks whether members of the host exist before it uses them. The program names none of them.
const decoded = text => Buffer.from(text).toString(); // text that is decoded at run time is unknown to the compiler
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const never = process.argv.length > 99;
const say = async f => { let answer; try { answer = await f(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); } console.log(answer); };
say(async () => new Function(decoded("return [typeof Bun.gzipSync, 'gzipSync' in Bun, typeof structuredClone, typeof WebSocket, typeof Bun.gzipSync === 'function' ? Bun.gzipSync('abc').length > 0 : 'absent'].join()"))());
