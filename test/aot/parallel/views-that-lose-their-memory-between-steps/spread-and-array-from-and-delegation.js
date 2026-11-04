function listed(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 1;
  return [...view, (buffer.transfer(), 7), ...view].join();
}
function mapped(buffer) {
  const view = new Uint8Array(buffer);
  let calls = 0;
  try {
    return Array.from(view, (value) => { calls++; buffer.transfer(); return value; }).join() + " | " + calls;
  } catch (e) {
    return e.constructor.name + " | " + calls;
  }
}
function* each(view) { yield* view; return "over"; }
function delegated(buffer, at) {
  const steps = each(new Uint8Array(buffer));
  let text = "";
  try {
    for (let i = 0; i < 4; i++) {
      if (i === at) buffer.transfer();
      const step = steps.next();
      text += step.value + ":" + step.done + " ";
    }
  } catch (e) {
    text += e.constructor.name;
  }
  return text;
}
for (let i = 0; i < 3; i++) {
  try { console.log(listed(new ArrayBuffer(1))); } catch (e) { console.log(e.constructor.name); }
  console.log(mapped(new ArrayBuffer(2)));
  console.log(delegated(new ArrayBuffer(1), 0));
  console.log(delegated(new ArrayBuffer(1), 1));
  console.log(delegated(new ArrayBuffer(1), 2));
  console.log(delegated(new ArrayBuffer(1), 3));
}
