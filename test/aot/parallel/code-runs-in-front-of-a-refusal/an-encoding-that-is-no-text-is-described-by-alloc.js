let asked = 0;
class Encoding { static get name() { asked++; return "E"; } }
try { Buffer.alloc(4, "a", new Encoding()); } catch (e) { console.log(e.code); }
console.log(asked > 0);
