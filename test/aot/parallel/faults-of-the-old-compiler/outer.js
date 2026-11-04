let failed = false;
const note = () => { failed = true; };
class S { run(t, onError) { try { this.step(t, onError); } catch (e) { onError(e); } } step(t, onError) { this.data = JSON.parse(t); this.close = () => true; this.valid = true; this.onError = onError; } }
function look(c) { return typeof c.close + " valid " + c.valid + " " + typeof c.data; }
function main(t) { const c = new S(); c.run(t, note); console.log(look(c) + " failed " + failed); }
main(process.argv[2] ?? "{");
