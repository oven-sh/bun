class Base { get level() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "of the class"; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function put(o, v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { o.level = v; return "stored"; } catch (e) { return e.constructor.name; } }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.level; }
const early = new Sub();
let first = "", second = "";
for (let i = 0; i < 300; i++) first = put(early, 5);
Object.setPrototypeOf(Sub.prototype, Base.prototype);
const late = new Sub();
for (let i = 0; i < 300; i++) second = put(late, 6);
console.log(first, read(early), second, read(late));
