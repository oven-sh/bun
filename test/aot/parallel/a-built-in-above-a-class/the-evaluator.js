function below(kind) { let top = Object; if (kind) top = kind.top; class Below extends top {} return Below; }
const D = below({ top: Function }); console.log(new D("return 3 + 4")(), new D("a", "return a * 2")(4));
