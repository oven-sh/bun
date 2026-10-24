// Guards that fail once: t first. It prints what plain Bun prints.
    const rounds = Number(process.argv[2]);
    function Point(x) { this.x = x; this.y = 2; }
    Point.prototype.sum = function () { return this.x + this.y; };
    let total = 0;
    for (let i = 0; i < rounds; i++) total += new Point(i).sum();
    console.log(total === rounds * (rounds - 1) / 2 + 2 * rounds);

    function Watched(x) { this.x = x; }
    let seen = 0;
    Object.defineProperty(Watched.prototype, "x", { set(value) { seen += value; }, get() { return -1; } });
    let read = 0;
    for (let i = 0; i < 4; i++) read += new Watched(i).x;
    console.log(seen, read);

    function Replaced() { this.a = 1; }
    Replaced.prototype = { kind: "replaced" };
    let kinds = "";
    for (let i = 0; i < 3; i++) kinds += new Replaced().kind + " ";
    Replaced.prototype = { kind: "replaced again" };
    for (let i = 0; i < 3; i++) kinds += new Replaced().kind + " ";
    console.log(kinds.trim());

    function Fixed(x) { this.x = x; }
    Object.defineProperty(Fixed.prototype, "x", { value: 7, writable: false });
    let refused = 0;
    for (let i = 0; i < 3; i++) {
      try {
        new Fixed(i);
      } catch (error) {
        refused += error instanceof TypeError ? 1 : 100;
      }
    }
    console.log(refused);
  