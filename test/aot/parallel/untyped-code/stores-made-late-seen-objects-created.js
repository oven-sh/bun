// Objects are created above whatever one array holds: a value that comes from outside and, step by step, an instance of one more class. The last steps store on the instances that came in long before, under names
// that nothing was stored under until then: a value, a function, a getter. The names are read on the created objects.
// Flags: --aot-check=flow-fixpoint
const all = [globalThis[process.argv[2] ?? "nothingOfThisName"]];
class C0 {
  constructor() {
    this.own0 = 0;
  }
}
class C1 {
  constructor() {
    this.own1 = 1;
  }
}
class C2 {
  constructor() {
    this.own2 = 2;
  }
}
class C3 {
  constructor() {
    this.own3 = 3;
  }
}
class C4 {
  constructor() {
    this.own4 = 4;
  }
}
class C5 {
  constructor() {
    this.own5 = 5;
  }
}
class C6 {
  constructor() {
    this.own6 = 6;
  }
}
class C7 {
  constructor() {
    this.own7 = 7;
  }
}
class C8 {
  constructor() {
    this.own8 = 8;
  }
}
class C9 {
  constructor() {
    this.own9 = 9;
  }
}
class C10 {
  constructor() {
    this.own10 = 10;
  }
}
class C11 {
  constructor() {
    this.own11 = 11;
  }
}
class C12 {
  constructor() {
    this.own12 = 12;
  }
}
class C13 {
  constructor() {
    this.own13 = 13;
  }
}
const storesGetter = {
  run() {
    Object.defineProperty(all[5], "lateGetter", {
      get() {
        return "getter above " + Object.keys(this).length + " own keys";
      },
    });
    return null;
  },
};
const storesFunction = {
  run() {
    all[3].lateFunction = function () {
      return "called with own3 " + this.own3;
    };
    return storesGetter;
  },
};
const storesValue = {
  run() {
    all[1].lateValue = "stored on the first";
    all[9].lateValue = "stored on the ninth";
    return storesFunction;
  },
};
const step13 = {
  run() {
    all.push(new C13());
    return storesValue;
  },
};
const step12 = {
  run() {
    all.push(new C12());
    return step13;
  },
};
const step11 = {
  run() {
    all.push(new C11());
    return step12;
  },
};
const step10 = {
  run() {
    all.push(new C10());
    return step11;
  },
};
const step9 = {
  run() {
    all.push(new C9());
    return step10;
  },
};
const step8 = {
  run() {
    all.push(new C8());
    return step9;
  },
};
const step7 = {
  run() {
    all.push(new C7());
    return step8;
  },
};
const step6 = {
  run() {
    all.push(new C6());
    return step7;
  },
};
const step5 = {
  run() {
    all.push(new C5());
    return step6;
  },
};
const step4 = {
  run() {
    all.push(new C4());
    return step5;
  },
};
const step3 = {
  run() {
    all.push(new C3());
    return step4;
  },
};
const step2 = {
  run() {
    all.push(new C2());
    return step3;
  },
};
const step1 = {
  run() {
    all.push(new C1());
    return step2;
  },
};
const step0 = {
  run() {
    all.push(new C0());
    return step1;
  },
};
const made = [];
function show() {
  for (const below of made) console.log(below.own0, below.own13, below.lateValue, below.lateFunction?.(), below.lateGetter, below.missing);
}
let step = step0;
while (step) {
  step = step.run();
  if (all.length > made.length + 1) made.push(Object.create(all[all.length - 1]));
}
show();
