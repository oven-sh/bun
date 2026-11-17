// Under: --aot-check=Validate: a definition lays a name that the layout does not list and a getter is found above: the judge of the names that are laid asks that the layout is out of sight
class Holder { get size() { return 1; } }
const held = new Holder();
Object.defineProperty(held, "size", { value: 2 });
function read(object) { return object.size; }
console.log(read(held), read(new Holder()));
