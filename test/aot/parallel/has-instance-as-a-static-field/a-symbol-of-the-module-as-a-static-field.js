const mark = Symbol("mark");
class Base { static [mark]() { return "method"; } }
class Heir extends Base { static [mark] = () => "field"; }
console.log(Base[mark](), Heir[mark](), Object.getOwnPropertySymbols(Heir).length, typeof Heir[mark]);
class Twice { static a = 1; static ["a"] = 2; static b = Twice.a; } console.log(Twice.a, Twice.b, Object.keys(Twice).join());
