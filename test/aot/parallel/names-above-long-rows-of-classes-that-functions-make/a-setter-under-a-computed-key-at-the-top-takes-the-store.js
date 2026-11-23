const seen = [];
const name = ["le", "vel"].join("");
class Ground {
  set [name](value) {
    seen.push("computed " + value);
  }
}
function raise0(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step0 = 0;
    }
  };
}
function raise1(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step1 = 1;
    }
  };
}
function raise2(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step2 = 2;
    }
  };
}
function raise3(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step3 = 3;
    }
  };
}
function raise4(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step4 = 4;
    }
  };
}
function raise5(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step5 = 5;
    }
  };
}
function raise6(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step6 = 6;
    }
  };
}
function raise7(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step7 = 7;
    }
  };
}
function raise8(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step8 = 8;
    }
  };
}
function raise9(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step9 = 9;
    }
  };
}
function raise10(Above) {
  return class extends Above {
    constructor() {
      super();
      this.step10 = 10;
    }
  };
}
function raise11(Above) {
  return class extends Above {
    constructor() {
      super();
      this.level = 7;
    }
  };
}
let Top = Ground;
Top = raise0(Top);
Top = raise1(Top);
Top = raise2(Top);
Top = raise3(Top);
Top = raise4(Top);
Top = raise5(Top);
Top = raise6(Top);
Top = raise7(Top);
Top = raise8(Top);
Top = raise9(Top);
Top = raise10(Top);
Top = raise11(Top);
const top = new Top();
console.log(seen.join("|"), Object.keys(top).join(), typeof top.level === "function" ? "a function" : String(top.level));
