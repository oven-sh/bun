let events = "";
function tick() { events += "c"; }
function makeList() {
  const list = [0, 0, 0];
  Object.defineProperty(list, 2, { get() { events += "2"; return 0; } });
  Object.defineProperty(list, 0, { get() { events += "0"; return 0; } });
  Object.defineProperty(list, 1, { get() { events += "1"; return 0; } });
  return list;
}
function receiver() { events += "t"; return null; }
function run() { tick.apply(receiver(), makeList()); }
for (let i = 0; i < 300; i++) run();
console.log(events.length, events.slice(0, 10), events.slice(-5));
