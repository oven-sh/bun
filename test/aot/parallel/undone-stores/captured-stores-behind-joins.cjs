// Some paths of an iteration store into a captured variable. A store behind their join is undone too where the iteration restarts.
const lines = [];
(function () {
  let trace = "",
    count = 0,
    last = null,
    flag = false;
  function tell(q) {
    trace += q;
    return q;
  }
  function add(q) {
    count = count * 10 + q;
  }
  function keep(q) {
    last = q;
    flag = !flag;
  }
  class A {
    constructor(i) {
      this.pos = i;
    }
    step(x) {
      this.pos += x;
      return this.pos;
    }
  }
  class Z {
    constructor(i) {
      this.pos = "z" + i;
    }
    step() {
      return "zz";
    }
  }
  function falls(o, i) {
    let y = 0,
      z = 0;
    do {
      switch (o.pos) {
        case 1:
          tell(1);
          break;
        case "z1":
          tell(2);
        default:
          tell(3);
      }
      y += o.step(1);
      o.pos = i;
    } while (z++ < 2);
    return y;
  }
  function reads(o, i) {
    let y = 0,
      z = 0;
    do {
      switch (o.pos) {
        case 1:
          add(1);
          break;
        case "z1":
          add(2);
        default:
          add(3);
      }
      y += o.pos;
      o.pos = i;
    } while (z++ < 2);
    return y;
  }
  function branches(o, i) {
    let y = 0;
    for (let z = 0; z < 4; z++) {
      if (z & 1) keep(z);
      if (z > 1) keep(o.pos);
      keep(i);
      tell(z);
      if (z === 3) tell(9);
      y += o.pos;
      if (z === 2) o.pos = i;
    }
    return y;
  }
  function labels(o, i) {
    let y = 0;
    for (let z = 0; z < 4; z++) {
      outer: {
        if (z === 1) break outer;
        add(z);
        if (z === 2) break outer;
        tell(z);
      }
      add(5);
      tell("x");
      y += o.pos;
      if (z === 1) o.pos = i;
    }
    return y;
  }
  function caught(o, i) {
    let y = 0;
    for (let z = 0; z < 4; z++) {
      try {
        if (z === 1) throw z;
        tell("t");
      } catch {
        tell("c");
      } finally {
        add(z);
      }
      tell("e");
      y += o.pos;
      if (z === 2) o.pos = i;
    }
    return y;
  }
  function own(o, i) {
    let y = 0,
      own = "";
    const see = () => own;
    for (let z = 0; z < 4; z++) {
      if (z > 2) own += "a";
      else if (z === 1) own += "b";
      own += z;
      if (z === 0) own = own + "q";
      y += o.pos;
      if (z === 1) o.pos = i;
    }
    return y + see();
  }
  const odd = i => {
    const a = new A(i);
    a.pos = "s";
    return a;
  };
  for (const f of [falls, reads, branches, labels, caught, own]) {
    for (const [o, i] of [[new Z(1), 3], [new A(1), 0], [odd(3), undefined], [new A(1), true], [new A(1), "q"], [new A(2), 1.5], [new A(1), null], [new A(2), 2 ** 40], [{ pos: 1, step: x => x }, 4n], [new A(1), 2]]) {
      trace = "";
      count = 0;
      last = null;
      let r;
      try {
        r = f(o, i);
      } catch (e) {
        r = e.constructor.name;
      }
      lines.push([f.name, String(r), trace, count, String(last), flag].join(" "));
    }
  }
})();
console.log(lines.join("\n"));
