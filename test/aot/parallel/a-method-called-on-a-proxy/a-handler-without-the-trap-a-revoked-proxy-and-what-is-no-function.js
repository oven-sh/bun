// A method called on a Proxy whose handler has no get trap, gets one later, loses it, on a revoked Proxy, and where the trap answers with what cannot be called.
const target = { name: () => "of the target" };
const handler = {};
const proxy = new Proxy(target, handler);
const ask = (holder) => holder.name();
const said = [];
for (let i = 0; i < 3; i++) said.push(ask(proxy));
handler.get = () => () => "of the trap";
for (let i = 0; i < 3; i++) said.push(ask(proxy));
delete handler.get;
said.push(ask(proxy));
handler.get = () => 7;
try {
  said.push(ask(proxy));
} catch (error) {
  said.push(error.constructor.name);
}
handler.get = 7;
try {
  said.push(ask(proxy));
} catch (error) {
  said.push(error.constructor.name);
}
const { proxy: short, revoke } = Proxy.revocable(target, {});
said.push(ask(short));
revoke();
try {
  said.push(ask(short));
} catch (error) {
  said.push(error.constructor.name);
}
console.log(said.join(" . "));
