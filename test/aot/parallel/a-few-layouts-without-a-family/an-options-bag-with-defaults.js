function Client(options) { options = options || {}; this.host = options.host || "localhost"; this.port = options.port || 80; this.retries = options.retries === undefined ? 3 : options.retries; this.open = false; }
Client.prototype.key = function () { return this.host.length + this.port + this.retries; };
function run(count) { var total = 0, kept = []; for (var i = 0; i < count; i++) { var c = new Client(i & 1 ? { port: i & 1023 } : i & 2 ? { host: "h", retries: 0 } : undefined); if ((i & 65535) === 0) kept.push(c); total += c.key(); } return total + kept.length; }
console.log(run(300000));
