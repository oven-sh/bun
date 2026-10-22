// console.log finds a method of the host under Symbol.for("nodejs.util.inspect.custom") and hands it util.inspect, which has to be in the executable: a BroadcastChannel.
const channel = new BroadcastChannel("a");
console.log(channel);
channel.close();
