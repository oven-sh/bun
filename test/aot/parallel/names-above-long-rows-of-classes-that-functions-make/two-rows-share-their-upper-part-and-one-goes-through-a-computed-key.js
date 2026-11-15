const seen = [];
const name = ["le", "vel"].join("");
class Ground {}
function shared0(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step0 = 0;
    }
  };
}
function shared1(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step1 = 1;
    }
  };
}
function shared2(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step2 = 2;
    }
  };
}
function shared3(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step3 = 3;
    }
  };
}
function shared4(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step4 = 4;
    }
  };
}
function shared5(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step5 = 5;
    }
  };
}
function shared6(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step6 = 6;
    }
  };
}
function shared7(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step7 = 7;
    }
  };
}
function shared8(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step8 = 8;
    }
  };
}
function shared9(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step9 = 9;
    }
  };
}
let Top = Ground;
Top = shared0(Top);
Top = shared1(Top);
Top = shared2(Top);
Top = shared3(Top);
Top = shared4(Top);
Top = shared5(Top);
Top = shared6(Top);
Top = shared7(Top);
Top = shared8(Top);
Top = shared9(Top);
const Shared = Top;
function turn(Above) {
  return class extends Above {
    set [name](value) {
      seen.push("turned " + value);
    }
  };
}
function left0(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step0 = 0;
    }
  };
}
function left1(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step1 = 1;
    }
  };
}
function left2(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step2 = 2;
    }
  };
}
function left3(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step3 = 3;
    }
  };
}
function left4(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step4 = 4;
    }
  };
}
function left5(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step5 = 5;
    }
  };
}
function left6(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step6 = 6;
    }
  };
}
function left7(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step7 = 7;
    }
  };
}
function left8(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step8 = 8;
    }
  };
}
function left9(Above) {
  return class extends Above {
    constructor() {
      super();
      this.level = 7;
    }
  };
}
Top = turn(Shared);
Top = left0(Top);
Top = left1(Top);
Top = left2(Top);
Top = left3(Top);
Top = left4(Top);
Top = left5(Top);
Top = left6(Top);
Top = left7(Top);
Top = left8(Top);
Top = left9(Top);
const Left = Top;
function right0(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step0 = 0;
    }
  };
}
function right1(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step1 = 1;
    }
  };
}
function right2(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step2 = 2;
    }
  };
}
function right3(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step3 = 3;
    }
  };
}
function right4(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step4 = 4;
    }
  };
}
function right5(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step5 = 5;
    }
  };
}
function right6(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step6 = 6;
    }
  };
}
function right7(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step7 = 7;
    }
  };
}
function right8(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step8 = 8;
    }
  };
}
function right9(Above) {
  return class extends Above {
    constructor() {
      super();
      this.level = 8;
    }
  };
}
Top = Shared;
Top = right0(Top);
Top = right1(Top);
Top = right2(Top);
Top = right3(Top);
Top = right4(Top);
Top = right5(Top);
Top = right6(Top);
Top = right7(Top);
Top = right8(Top);
Top = right9(Top);
const Right = Top;
const right = new Right();
const top = new Left();
console.log(Object.keys(right).includes("level"), right.level);
console.log(seen.join("|"), Object.keys(top).includes("level"), String(top.level));
