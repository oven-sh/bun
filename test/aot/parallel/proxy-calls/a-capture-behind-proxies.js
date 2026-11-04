const adds = (base) => (x) => base + x;

function behindProxies(target) {
  let chain = target;
  for (let i = 0; i < 3; i++) chain = new Proxy(chain, Object.create(null));
  return chain;
}

console.log(behindProxies(adds(1))(10));
