const [loader, ...rest] = process.argv.slice(2);
const src = rest.join(" ");
try { console.log(JSON.stringify(new Bun.Transpiler({ loader }).transformSync(src))); } catch (e) { console.log("ERR", (e.errors ?? [e]).map(x => x.message)); }
