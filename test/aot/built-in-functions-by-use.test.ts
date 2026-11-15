// Native code asks for built-in JavaScript by number. An executable holds only what its program can make native code ask for.
// Each program here reaches one of them by one road, and needs a text on stdin or a parent that listens on a channel.
// The programs that need neither are files under ./parallel/host-object-members.
import { describePrograms, type Program } from "./programs-by-use";

const programs: Record<string, Program> = {
  "for await of console": {
    source: `for await (const line of console) { console.log("read", line); if (line === "second") break; }`,
    stdin: "first\nsecond\nthird\n",
  },
  "console[Symbol.asyncIterator]": {
    source: `const lines = console[Symbol.asyncIterator](); console.log((await lines.next()).value); await lines.return?.();`,
    stdin: "only\n",
  },
  "process.stdin": {
    source: `let all = ""; process.stdin.on("data", chunk => (all += chunk)).on("end", () => console.log(JSON.stringify(all)));`,
    stdin: "given\n",
  },
  "process.send and a message": {
    source: `process.on("message", message => { console.log("got", JSON.stringify(message)); process.disconnect(); }); process.send({ hello: 1 });`,
    ipc: "json",
  },
  "a message with buffers that only arrives": {
    source: `process.once("message", message => { console.log("got", message.constructor.name, [...message.bytes].join()); process.exit(0); });`,
    ipc: "advanced",
    greeting: { bytes: new Uint8Array([1, 2, 3]) },
  },
  "a message for a listener added by another name": {
    source: `process.prependOnceListener("message", message => { console.log("got", JSON.stringify(message)); process.exit(0); });`,
    ipc: "json",
    greeting: { hello: 3 },
  },
  "a parent that gets a message with buffers": {
    source: `const env = { ...process.env }; delete env.BUN_JSC_crashIfInterpreterIsUsed; const child = Bun.spawn({ cmd: [process.env.PLAIN_BUN, "child.mjs"], env, serialization: "advanced", stdio: ["ignore", "inherit", "inherit"], ipc(message) { console.log("got", message.constructor.name, [...message.bytes].join()); child.disconnect(); } }); console.log(await child.exited);`,
    files: { "child.mjs": `process.send({ bytes: new Uint8Array([4, 5]) });` },
  },
};

describePrograms("what native code asks for is in the executable", programs);
