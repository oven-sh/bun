class Connection { constructor() {  this.connected = false; this.retries = 0; this.onClose = () => "closed"; } connect(text, _options) { try { this.config = JSON.parse(text); this.retries = 3; this.connected = true; } catch (err) { this.lastError = "bad config"; } } }
function describe(c) { return (c.connected ? "connected " : "failed ") + (c.lastError === undefined ? "no error " : "error ") + (c.retries === 3 ? "three " : "zero ") + typeof c.config + " " + typeof c.onClose; }
function main(text) { const c = new Connection(); c.connect(text); console.log(describe(c)); }
main(process.argv[2] ?? "{");
