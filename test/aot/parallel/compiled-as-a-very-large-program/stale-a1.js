// Flags: --aot-limit=MaxWarmCodeValues:1
// A callback stores into a variable of the function that handed it on, through a table of handlers under a key out of parsed data: the read behind the call sees the store. Six dull statements in front; called at two places.
const handlers = {
  open(done) { return { run() { done({ ok: true }); } }; },
  close(done) { return { run() { done({ ok: false }); } }; },
};
const type = JSON.parse('{"type":"open"}').type;
const stats = { calls: 0, total: 0, largest: 0, smallest: 0, odd: 0, even: 0 };
function request(weight) {
  stats.calls += 1;
  stats.total += weight;
  if (stats.total > 100) stats.total -= 100;
  if (weight > stats.largest) stats.largest = weight;
  if (weight < stats.smallest || stats.calls === 1) stats.smallest = weight;
  if (weight % 2 === 1) stats.odd += 1; else stats.even += 1;
  let result = null;
  handlers[type](r => { result = r; }).run();
  return JSON.stringify(result);
}
console.log(request(1));
console.log(request(2));
