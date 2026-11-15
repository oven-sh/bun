// An untyped package and a program of it (channels): limits, retries, a queue with priorities, timeouts by ticks; no clock
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
(async () => {
  const c = new lib.Channel(), got = []; const readers = [0, 1].map(async n => { for await (const v of c) { got.push(n + ':' + v); await lib.tick(n + 1); } got.push('end' + n); });
  for (let i = 0; i < 15; i++) { c.put(i % 4 === 3 ? 'v' + i : i); if (i % 3 === 2) await lib.tick(4); say(i, got.splice(0).join(' '), c.values.length, c.takers.length); } c.close(); await Promise.all(readers); say(got.join(' ')); try { c.put(1); } catch (e) { say(e.message); }
  for (let k = 1; k < 7; k++) { const fails = []; try { say(k, await lib.retry(async n => { if (n < k) throw new RangeError('try ' + n); return 'done ' + n; }, 4, async (e, i) => { fails.push(i + e.message); await lib.tick(1); }), fails.join()); } catch (e) { say(k, e.name, e.message, fails.length); } }
  const r = await Promise.allSettled([lib.retry(() => 5, 1), lib.retry(() => { throw 'text'; }, 2), lib.retry(n => n === 2 ? 'two' : Promise.reject(new Error('no')), 3)]); say(JSON.stringify(r.map(x => x.status + ':' + (x.value || x.reason)))); say(await Promise.race([lib.tick(5).then(() => 'slow'), lib.tick(2).then(() => 'fast')]), await Promise.any([Promise.reject(1), lib.tick(1).then(() => 'any')]));
})();
