class Ping extends Event { constructor() { super("ping"); this.n = 1; } }
class Hub extends EventTarget { constructor() { super(); this.n = 1; } }
function next(box) { return box.n + 1; }
const hub = new Hub(), ping = new Ping();
hub.addEventListener("ping", function (event) { event.n = "text"; this.n = "text"; });
console.log(next(hub), next(ping));
hub.dispatchEvent(ping);
console.log(next(hub), next(ping));
