// A generator that is stepped by name makes no result objects.

const lines = [];
function* count(limit) {
  for (let i = 0; i < limit; i++) yield i;
  return "end";
}
function* echoes() {
  let sent;
  try {
    sent = yield "ready";
    while (sent !== "stop") sent = yield "echo " + sent;
  } catch (error) {
    sent = yield "caught " + error.message;
  }
  return "stopped by " + sent;
}
function sumByNext(generator) {
  let total = 0;
  for (let step = generator.next(); !step.done; step = generator.next()) total += step.value;
  return total;
}
function drain(generator) {
  const seen = [];
  let step = generator.next();
  while (!step.done) {
    seen.push(step.value);
    step = generator.next();
  }
  seen.push(step.value);
  return seen.join();
}
function stopEarly(generator) {
  const first = generator.next();
  const last = generator.return("returned");
  return first.value + " " + first.done + " " + last.value + " " + last.done;
}
function failInside(generator) {
  generator.next();
  const caught = generator.throw(new Error("thrown"));
  return caught.value + " " + caught.done;
}
lines.push("sums: " + [sumByNext(count(0)), sumByNext(count(1)), sumByNext(count(10000))]);
lines.push("drained: " + drain(count(3)) + " | " + drain(count(0)));
lines.push("stopped early: " + stopEarly(count(3)));
lines.push("fails inside: " + failInside(echoes()));
console.log(lines.join("\n"));
