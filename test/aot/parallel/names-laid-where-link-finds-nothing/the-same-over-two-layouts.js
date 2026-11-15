// Under: --aot-check=Validate: the same where two layouts meet at the definition
class Holder { get size() { return 1; } }
class Heir extends Holder { more = 3; }
class Answers { constructor(given) { return given; } }
class Stamp extends Answers { size = 2; }
const list = [new Holder(), new Heir()];
for (const each of list) new Stamp(each);
function read(object) { return object.size; }
console.log(read(list[0]), read(list[1]), read(new Holder()), read(new Heir()));
