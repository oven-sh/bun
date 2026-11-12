function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const channel = new MessageChannel();
channel.port1.onmessage = () => { seen = read(); channel.port1.close(); };
channel.port2.postMessage(1);
await new Promise(resolve => setTimeout(resolve, 30));
const late = { rate: 0.2 };
console.log(seen, read());
