class Base { constructor(a, b = "default", ...rest) { this.a = a; this.b = b; this.rest = rest; this.count = arguments.length; } }
class Given extends Base { own = 1; }
class Twice extends Given { more = 2; }
for (let i = 0; i < 3; i++) console.log(JSON.stringify([new Given(), new Given(i), new Given(i, undefined, 3), new Twice(i, 2, 3, 4), new Twice()]));
