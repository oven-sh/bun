const tries = {
  proxyNew: () => typeof new (new Proxy(Function, {}))("return 3"),
};
for (const [name, run] of Object.entries(tries)) { try { console.log(name, String(run())); } catch (e) { console.log(name, "threw", e.name, String(e.message).slice(0, 90)); } }
