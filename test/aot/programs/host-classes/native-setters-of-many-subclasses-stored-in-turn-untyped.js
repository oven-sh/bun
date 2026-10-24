// Two native setters of Event, stored to in turn at one place on instances of hundreds of subclasses.
function write(event, value) {
  event.cancelBubble = value;
  event.returnValue = value;
}
for (const shapes of [1, 40, 100, 300, 1200]) {
  const made = [];
  for (let i = 0; i < shapes; i++) made.push(new (class extends Event {})("e", { cancelable: true }));
  for (let round = 0; round < 4; round++) for (let i = 0; i < made.length; i++) write(made[i], (round + i) % 3 === 0);
  let stopped = 0;
  let prevented = 0;
  for (const event of made) {
    stopped += event.cancelBubble ? 1 : 0;
    prevented += event.defaultPrevented ? 1 : 0;
  }
  console.log(shapes, "subclasses:", stopped, prevented);
}
