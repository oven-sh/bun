const index = +JSON.parse("1.5");
function found() {
  return "seven" + this.id;
}
class Base {
  id = 1;
}
class Deep extends Base {
  n() {
    return "deep";
  }
}
class Middle extends Deep {
}
class Low extends Middle {
  n() {
    return "low";
  }
}
class G0 extends Base {
  g0() {
    return 0 + this.id;
  }
}
class G1 extends Base {
  g1() {
    return 1 + this.id;
  }
}
class G2 extends Base {
  g2() {
    return 2 + this.id;
  }
}
class G3 extends Base {
  g3() {
    return 3 + this.id;
  }
}
class G4 extends Base {
  g4() {
    return 4 + this.id;
  }
}
class G5 extends Base {
  g5() {
    return 5 + this.id;
  }
}
const one = new G2();
one[index] = found;
const all = [new Base(), new Deep(), new Middle(), new Low(), new G0(), new G1(), one, new G3(), new G4(), new G5()];
const say = x => (x["1.5"] ? x["1.5"]() : "none");
const out = [];
for (let turn = 0; turn < 40; turn++) {
  out.push(all.map(say).join());
}
console.log("SAID z3", out[0], out[39], new Set(out).size, out.length);
