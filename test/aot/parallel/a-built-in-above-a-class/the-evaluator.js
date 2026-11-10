function define(params) { const Parent = params?.Parent ?? Object; class Definition extends Parent {} return Definition; }
const D = define({ Parent: Function }); console.log(new D("return 3 + 4")(), new D("a", "return a * 2")(4));
