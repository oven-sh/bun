// A proxy of the function constructor is called.
const tries = {
  proxyCall: () => typeof new Proxy(Function, {})(),
};
for (const [name, run] of Object.entries(tries)) { try { console.log(name, String(run())); } catch (e) { console.log(name, "threw", e.name, String(e.message).slice(0, 90)); } }
