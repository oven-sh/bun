function stepped(buffer, at) {
  const view = new Uint8Array(buffer);
  const steps = view[Symbol.iterator]();
  let text = "";
  for (let i = 0; i < 4; i++) {
    if (i === at) buffer.transfer();
    try {
      const step = steps.next();
      text += step.value + ":" + step.done + " ";
    } catch (e) {
      text += e.constructor.name + " ";
    }
  }
  return text;
}
for (let i = 0; i < 3; i++) {
  for (let at = 0; at < 4; at++)
    console.log(stepped(new ArrayBuffer(1), at));
}
