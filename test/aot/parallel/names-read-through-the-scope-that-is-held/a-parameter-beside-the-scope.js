function make(skip, text) {
  let at = 0;
  function step() { at++; return skip ? at * 2 : at; }
  function again() { return skip + ":" + step(); }
  return { step, again, where: () => at, text: () => text };
}
for (const skip of [true, false, 0, "s"]) { const made = make(skip, "t"); console.log(made.step(), made.again(), made.where(), made.text()); }
