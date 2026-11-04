const Tracked = { set p(v) { this.raw = v; } };
class User { raw = 0; }
class Order { raw = 0; extra = 2; }
for (const K of [User, Order]) Object.defineProperties(K.prototype, Object.getOwnPropertyDescriptors(Tracked));
function put(m, v) { m.p = v; return m.raw; }
const user = new User();
const order = new Order();
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (e) { e.context = order; note = e.toString(); }
console.log(put(user, 5), put(order, 6), put(user, 7), order.extra);
console.log(note.length);
