// RUN: link
// Each way in which a file hangs the prototype object of a function below that of another function or of a class: the layout names its base.
// CHECK: layout [[class]] kind=Instance name="Class"
// CHECK: layout [[base]] kind=Instance name="Base"
// CHECK: layout [[relinked]] kind=Instance name="Relinked" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="Reflected" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="Created" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="CreatedWithDescriptors" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="UnderAnInstance" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="UnderALiteral" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="StoredLink" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="RelinkedLiteral" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="ThroughAnAlias" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="Twice" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="UnderAClass" {{*}} base=[[class]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="Below" {{*}} base=[[relinked]] {{*}}flags=[IsConstructorFunction]

export function Base() {}
export function Relinked() {}
Object.setPrototypeOf(Relinked.prototype, Base.prototype);
export function Reflected() {}
Reflect.setPrototypeOf(Reflected.prototype, Base.prototype);
export function Created() {}
Created.prototype = Object.create(Base.prototype);
export function CreatedWithDescriptors() {}
CreatedWithDescriptors.prototype = Object.create(Base.prototype, { constructor: { value: CreatedWithDescriptors } });
export function UnderAnInstance() {}
UnderAnInstance.prototype = new Base();
export function UnderALiteral() {}
UnderALiteral.prototype = { __proto__: Base.prototype, constructor: UnderALiteral };
export function StoredLink() {}
StoredLink.prototype.__proto__ = Base.prototype;
export function RelinkedLiteral() {}
RelinkedLiteral.prototype = Object.setPrototypeOf({ constructor: RelinkedLiteral }, Base.prototype);
const { setPrototypeOf } = Object;
export function ThroughAnAlias() {}
setPrototypeOf(ThroughAnAlias.prototype, Base.prototype);
export function Twice() {}
Twice.prototype = Object.create(Base.prototype);
Object.setPrototypeOf(Twice.prototype, Base.prototype);
export class Class {}
export function UnderAClass() {}
Object.setPrototypeOf(UnderAClass.prototype, Class.prototype);
export function Below() {}
Object.setPrototypeOf(Below["prototype"], Relinked["prototype"]);
