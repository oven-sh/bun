// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const channel = new BroadcastChannel("x");
console.log(channel);
channel.close();
