class Base { "-2"() { return "base"; } } class A extends Base { m() { return this["-2"](); } } const p = A.prototype; p["-2"] = () => "shadow"; console.log(new A().m());
