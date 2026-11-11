let Point;
function define() {
    let made = 0;
    function Made(x) { this.x = x + ++made; }
    Point = Made;
}
const table = { define, size: 3 };
const key = process.argv[3] ?? "size";
define();
console.log("SAID p14 " + typeof table[key] + " " + new Point(1).x + " " + new Point(1).x);
