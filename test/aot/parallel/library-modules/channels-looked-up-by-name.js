// node:diagnostics_channel keeps its channels in a Map that it reads and writes under the engine's private names. A thousand turns
// look one channel up by its name, ask for its subscribers, subscribe and leave again, and make a channel under a new name: seven
// reads and a write of that Map a turn. Compiled code reaches the engine's functions without a lookup by name: with one for each
// read and write a turn has 52 lookups in the place of 26.
// COUNT: arrivals <= 27000
const dc = require("node:diagnostics_channel");

const subscriber = () => {};
const channel = dc.channel("looked-up");
channel.subscribe(() => {});

let same = 0;
let active = 0;
let left = 0;
let idle = 0;
for (let i = 0; i < 1000; i++) {
  if (dc.channel("looked-up") === channel) same++;
  if (dc.hasSubscribers("looked-up")) active++;
  dc.subscribe("looked-up", subscriber);
  if (dc.unsubscribe("looked-up", subscriber)) left++;
  if (!dc.channel("made-" + i).hasSubscribers) idle++;
}
console.log(same, active, left, idle);
