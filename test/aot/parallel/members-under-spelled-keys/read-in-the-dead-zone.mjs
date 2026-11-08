// The class is evaluated in front of the constant that holds its key.
function define() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return class { [early]() { return "early" + work; } [name]() { return "name"; } };
}
try { define(); console.log("no error"); } catch (e) { console.log(e.name, e.message); }
const early = Symbol("early");
try { define(); console.log("no error"); } catch (e) { console.log(e.name, e.message); }
const name = "name";
const Made = define(), Other = define();
let said = "";
for (let i = 0; i < 300; i++) { const one = i & 1 ? new Made() : new Other(); said = one[early]() + one.name() + (one instanceof Made); }
console.log(said, Made === Other, Made.prototype[early] === Other.prototype[early]);
