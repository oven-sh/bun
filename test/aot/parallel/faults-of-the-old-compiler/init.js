class S { init(t, loud) { try { this.data = JSON.parse(t); this.close = () => true; this.valid = true; } catch (e) {} } }
function look(c) { return typeof c.close + " valid " + c.valid + " " + typeof c.data; }
function main(t) { const c = new S(); c.init(t, false); console.log(look(c)); }
main(process.argv[2] ?? "{");
