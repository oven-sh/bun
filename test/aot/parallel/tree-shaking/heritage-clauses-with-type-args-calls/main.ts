// The class after extends is named with type arguments, through a call, through a member, in a default export and in a class expression. Those are the only references to the bases.
import Unnamed from "./unnamed";

class Generic<T> { value(v: T) { return "generic " + v; } }
class FromCall { hello() { return "from a call"; } }
class FromMember { hello() { return "from a member"; } }
class InExpression { hello() { return "in a class expression"; } }
function pick() { return FromCall; }
const holder = { get Base() { return FromMember; } };

class A extends Generic<string> {}
class B extends pick() {}
class C extends holder.Base {}
const D = class extends InExpression {};

console.log(new A().value("a"), new B().hello(), new C().hello(), new D().hello(), new Unnamed().hello());
