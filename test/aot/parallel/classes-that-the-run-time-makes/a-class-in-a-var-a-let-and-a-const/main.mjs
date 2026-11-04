function readVar() {
  return typeof InVar;
}
console.log(readVar());
var InVar = class {
  m() {
    return "var";
  }
};
const InConst = class Named {
  m() {
    return Named.name;
  }
};
let InLet = class {
  m() {
    return "let";
  }
};
console.log(readVar(), InVar.name, new InVar().m(), InConst.name, new InConst().m(), InLet.name, new InLet().m());
InLet = class Other {
  m() {
    return "other";
  }
};
console.log(InLet.name, new InLet().m());
