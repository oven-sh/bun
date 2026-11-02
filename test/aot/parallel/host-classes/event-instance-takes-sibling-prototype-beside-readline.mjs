// An instance of one class below Event is given the prototype of another. node:readline brings a class below constructor functions whose prototypes have escaped.
import "node:readline";
class Below extends Event {}
class Sibling extends Event {}
const o = new Below("e");
Object.setPrototypeOf(o, Sibling.prototype);
console.log(o instanceof Sibling, o.type);
