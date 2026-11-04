const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const number = () => (process.argv.length > 100 ? 1 : 2);
class Base {
  constructor() {
    this.base = number();
  }
}
class Below extends Base {
  constructor(early) {
    const read = () => this.base;
    const begin = () => super();
    const said = early ? tell(unknown(read)) : "not asked";
    begin();
    this.said = said + " " + read() + " " + tell(begin);
  }
}
console.log(new Below(false).said, "|", new Below(true).said);
