// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. Three heirs, one below another, each with fields of its own in front of and behind the call of super.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
class One extends Box { constructor(items) { super(items); this.a = 1; this.b = 2; } }
class Two extends Box { constructor(items) { super(items); this.z = "z"; } }
class Below extends One { constructor(items) { super(items); this.c = 3; } }
const name = JSON.parse('"sum"');
for (let turn = 0; turn < 2; turn++) for (const items of [[0.5, 1.5, 2.5], [1, 2, 3], ["a", 1]]) console.log(new Box(items)[name](), new One(items)[name](), new Two(items)[name](), new Below(items)[name]());
