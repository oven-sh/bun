class Base { tag = "base"; }
function build(extra: string) { let made = 0; class Derived extends Base { label = extra; constructor() { const finish = () => { super(); made++; return new.target.name + extra; }; const said = finish(); this.tag = said + made; } } return Derived; }
const D = build("!"); console.log(new D().tag, new D().tag, new D().label);
