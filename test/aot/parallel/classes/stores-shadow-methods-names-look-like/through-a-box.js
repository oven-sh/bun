class Base { "-2"() { return "base"; } } class A extends Base {} const box = { held: A.prototype }; box.held["-2"] = () => "shadow"; const a = new A(); console.log(a["-2"](), new Base()["-2"]());
