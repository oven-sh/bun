const created = Object.create({ get slot() { this.count = (this.count || 0) + 1; return this.count; } });
function read(o) { return o.slot; }
let out = ""; for (let i = 0; i < 3; i++) out += read(created) + " " + created.count + ";"; console.log(out);
