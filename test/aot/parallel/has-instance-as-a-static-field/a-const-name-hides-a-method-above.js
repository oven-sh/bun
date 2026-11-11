const name = "tag", other = "size";
class Base { static tag() { return "base"; } static get size() { return 1; } }
class Heir extends Base { static [name] = () => "heir"; static [other] = 2; }
class Third extends Heir { }
console.log(Base.tag(), Heir.tag(), Third.tag(), Base.size, Heir.size, Third.size);
let text = ""; for (let i = 0; i < 5; i++) text += Third.tag() + Heir.size; console.log(text);
