function Base() {}
function Relinked() {}
Object.setPrototypeOf(Relinked.prototype, Base.prototype);
function Reflected() {}
Reflect.setPrototypeOf(Reflected.prototype, Base.prototype);
function Created() {}
Created.prototype = Object.create(Base.prototype);
function CreatedWithDescriptors() {}
CreatedWithDescriptors.prototype = Object.create(Base.prototype, { constructor: { value: CreatedWithDescriptors } });
function UnderAnInstance() {}
UnderAnInstance.prototype = new Base();
function UnderALiteral() {}
UnderALiteral.prototype = { __proto__: Base.prototype, constructor: UnderALiteral };
function StoredLink() {}
StoredLink.prototype.__proto__ = Base.prototype;
function RelinkedLiteral() {}
RelinkedLiteral.prototype = Object.setPrototypeOf({ constructor: RelinkedLiteral }, Base.prototype);
const { setPrototypeOf } = Object;
function ThroughAnAlias() {}
setPrototypeOf(ThroughAnAlias.prototype, Base.prototype);
var Expression = function () {};
Object.setPrototypeOf(Expression.prototype, Base.prototype);
function Twice() {}
Twice.prototype = Object.create(Base.prototype);
Object.setPrototypeOf(Twice.prototype, Base.prototype);
class Class {}
function UnderAClass() {}
Object.setPrototypeOf(UnderAClass.prototype, Class.prototype);
function Below() {}
Object.setPrototypeOf(Below["prototype"], Relinked["prototype"]);
