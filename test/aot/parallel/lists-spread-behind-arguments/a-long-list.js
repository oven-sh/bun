// A list too long to be laid out as arguments: the call as written says so, whoever is called.
class Taker { take(a, b, ...rest) { return rest.length; } }
function handsOn(taker, ...values) { return taker.take(1, 2, ...values); }
function spread(taker, list) { return taker.take(1, 2, ...list); }
const taker = new Taker();
const out = [];
for (const length of [0, 1, 100, 60000, 70000, 5000000]) {
  const list = new Array(length).fill(1);
  try { out.push(spread(taker, list)); } catch (error) { out.push(error.name); }
  try { out.push(handsOn.apply(null, [taker].concat(list))); } catch (error) { out.push(error.name); }
}
console.log(out.join());
