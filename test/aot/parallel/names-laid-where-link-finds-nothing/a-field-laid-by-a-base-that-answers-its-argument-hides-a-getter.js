// Under: --aot-check=Validate: the same through the field of another class, laid on what its base answers with
class Holder { get size() { return 1; } }
class Answers { constructor(given) { return given; } }
class Stamp extends Answers { size = 2; }
const held = new Holder();
new Stamp(held);
function read(object) { return object.size; }
console.log(read(held), read(new Holder()));
