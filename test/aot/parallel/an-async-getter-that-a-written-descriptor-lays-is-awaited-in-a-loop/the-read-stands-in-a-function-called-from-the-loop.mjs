const flags = {};
Object.defineProperty(flags, "ready", { get: async () => 3 });
function tell() { const answer = flags.ready; return answer instanceof Promise ? "a promise" : "no promise: " + typeof answer; }
for (let i = 0; i < 3; i++) console.log(tell(), await flags.ready);
