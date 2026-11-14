function Client(options) { options = options || {}; this.host = options.host || "localhost"; this.port = options.port || 80; this.retries = options.retries === undefined ? 3 : options.retries; }
function run(count) { let told = ""; for (let i = 0; i < count; i++) { const c = new Client(i % 4 === 0 ? { port: i } : i % 4 === 1 ? { host: "h" + i, retries: 0 } : i % 4 === 2 ? { retries: i, port: 1, host: "" } : undefined); told += c.host + ":" + c.port + ":" + c.retries + " "; } return told; }
console.log(run(12));
