let calls = 0; const seen = [];
process.stdin.on("data", () => { calls++; throw new Error("data-throw-fatal"); });
process.stdin.on("end", () => seen.push("end"));
process.stdin.on("close", () => seen.push("close"));
process.on("exit", code => console.log(JSON.stringify({ code, calls, seen })));
