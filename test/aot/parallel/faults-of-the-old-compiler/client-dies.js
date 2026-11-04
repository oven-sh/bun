class Client {
  constructor() { this.ready = false; }
  connect({ url, retries }) {
    this.retries = retries;
    try { const parsed = new URL(url); this.close = () => parsed.host; this.ready = true; } catch (e) { this.error = "bad url"; }
  }
}
function main(u) {
  const c = new Client();
  c.connect({ url: u, retries: 3 });
  console.log((c.ready ? "connected, " + c.close() : "failed: " + c.error) + ", retries " + c.retries);
}
main(process.argv[2] ?? "not a url");
