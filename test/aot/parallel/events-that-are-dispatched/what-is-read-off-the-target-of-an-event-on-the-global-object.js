const said = [];
addEventListener("a", event => {
  const target = event.target;
  said.push(`${target === globalThis} ${typeof target} ${target instanceof EventTarget} ${event.currentTarget === target} ${event.srcElement === target}`);
  said.push(`${typeof target.fetch} ${typeof target.Bun.version} ${target.structuredClone({ a: 1 }).a} ${new target.URL("http://localhost/b").pathname}`);
  said.push(`${target.crypto.randomUUID().length} ${target.Buffer.from("a").toString("hex")} ${target.process.pid > 0} ${target.btoa("a")}`);
  said.push(`${new target.TextDecoder().decode(new target.Uint8Array([97]))} ${target.JSON.stringify([1])} ${new target.Headers({ a: "b" }).get("a")}`);
  target.queueMicrotask(() => console.log(`${said.join(" | ")}`));
});
console.log(`${dispatchEvent(new Event("a"))}`);
