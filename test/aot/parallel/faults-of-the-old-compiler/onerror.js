class Config { load(text, onError) { try { this.data = JSON.parse(text); this.reload = () => true; this.ready = true; } catch (e) { onError(e.constructor.name.length > 0); } } }
async function read() { return process.argv[2] ?? "{"; }
async function main() { const raw = await read(); let bad = false; const config = new Config(); config.load(raw, (b) => { bad = b; }); console.log(typeof config.reload + " ready " + config.ready + " bad " + bad); }
main();
