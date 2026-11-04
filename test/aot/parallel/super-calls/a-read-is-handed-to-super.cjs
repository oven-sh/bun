class Above { constructor(name) { this.name = name; } }
class Below extends Above { constructor(options) { super(options.name); this.b = 2; } }
function Base(name) { this.name = name; }
class Under extends Base { constructor(options) { super(options.name); } }
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new Below({ name: "n" + i }).name, new Under({ name: "u" + i }).name); return out.join(" "); }
console.log(run(3), new Below({ name: 1 }).name, new Under({ name: 2 }).name);
