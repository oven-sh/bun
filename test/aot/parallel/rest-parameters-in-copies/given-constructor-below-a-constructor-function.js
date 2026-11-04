function Old(a, b) { this.a = a; this.b = b; this.count = arguments.length; this.target = new.target && new.target.name; }
Old.prototype.sum = function () { return this.a + this.b; };
class Given extends Old { extra = 3; }
for (let i = 0; i < 3; i++) { const made = new Given(i, 2, 9); console.log(made.sum(), made.count, made.target, made.extra, made instanceof Old); }
