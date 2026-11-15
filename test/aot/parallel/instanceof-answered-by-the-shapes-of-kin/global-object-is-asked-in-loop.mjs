// Under: --aot-harden=proof-checks: a miss is asked of the chain, and the global object's prototype lies behind a proxy
class Other {}
function count(value) {
  let count = 0;
  for (let i = 0; i < 20; i++) count += value instanceof Other ? 1 : 2;
  return count;
}
console.log(count(new Other()), count(globalThis));
