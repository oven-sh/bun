let calls = 0;
process.on("uncaughtException", e => console.log("uncaughtException:", e.message));
process.on("unhandledRejection", e => console.log("unhandledRejection:", e && e.message));
process.stdin.on("data", d => { calls++; if (calls === 1) throw new Error("boom"); });
process.stdin.on("end", () => console.log("end calls=" + calls));
