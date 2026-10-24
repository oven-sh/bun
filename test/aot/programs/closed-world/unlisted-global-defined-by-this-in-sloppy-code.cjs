function viaThis() { this.__viaThis = () => "this is the global object"; }
viaThis();
(function () { __viaAnUndeclaredName = () => "an assignment to a name nobody declares"; })();
console.log(globalThis.__viaThis(), globalThis.__viaAnUndeclaredName());
