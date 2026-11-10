// The row of addEventListener says that an Event is made. A MessageEvent is made by the channel: whoever gives BroadcastChannel rows says so there.
const sender = new BroadcastChannel("made up");
const receiver = new BroadcastChannel("made up");
const heard = new Promise(resolve => receiver.addEventListener("message", resolve));
sender.postMessage({ made: ["up"] });
const event = await heard;
console.log(`${event.constructor.name} ${event instanceof MessageEvent} ${event.data.made[0]} ${event.ports.length} ${event.type} [${event.lastEventId}]`);
sender.close();
receiver.close();
