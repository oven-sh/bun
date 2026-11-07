// One read site sees objects of forty classes, which come in step by step. Each name it reads is answered on the chains of a few of them only: by a method of a base class, a getter, a key that is computed,
// a prototype that is set late, a copy, a store made late, or by nothing at all.
// Flags: --aot-check=flow-fixpoint
const all = [];
class Base {
  inherited() {
    return "inherited";
  }
  get computed() {
    return "getter of " + this.constructor.name;
  }
}
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
class C7 extends Base {
  constructor() {
    super();
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
class C14 {
  constructor() {
    this.own14 = 14;
  }
}
class C15 {
  constructor() {
    this.own15 = 15;
  }
}
class C16 {
  constructor() {
    this.own16 = 16;
  }
}
class C17 {
  constructor() {
    this.own17 = 17;
  }
}
class C18 {
  constructor() {
    this.own18 = 18;
  }
}
class C19 {
  constructor() {
    this.own19 = 19;
  }
}
class C20 {
  constructor() {
    this.own20 = 20;
  }
}
class C21 {
  constructor() {
    this.own21 = 21;
  }
}
class C22 {
  constructor() {
    this.own22 = 22;
  }
}
class C23 extends Base {
  constructor() {
    super();
    this.own23 = 23;
  }
}
class C24 {
  constructor() {
    this.own24 = 24;
  }
}
class C25 {
  constructor() {
    this.own25 = 25;
  }
}
class C26 {
  constructor() {
    this.own26 = 26;
  }
}
class C27 {
  constructor() {
    this.own27 = 27;
  }
}
class C28 {
  constructor() {
    this.own28 = 28;
  }
}
class C29 {
  constructor() {
    this.own29 = 29;
  }
}
class C30 {
  constructor() {
    this.own30 = 30;
  }
}
class C31 {
  constructor() {
    this.own31 = 31;
  }
}
class C32 {
  constructor() {
    this.own32 = 32;
  }
}
class C33 {
  constructor() {
    this.own33 = 33;
  }
}
class C34 {
  constructor() {
    this.own34 = 34;
  }
}
class C35 {
  constructor() {
    this.own35 = 35;
  }
}
class C36 {
  constructor() {
    this.own36 = 36;
  }
}
class C37 {
  constructor() {
    this.own37 = 37;
  }
}
class C38 {
  constructor() {
    this.own38 = 38;
  }
}
class C39 {
  constructor() {
    this.own39 = 39;
  }
}
const late = {
  fromLatePrototype: "late prototype",
};
const source = {
  copied: "copied",
};
function keyOf(text) {
  return text + process.argv.length * 0;
}
const step39 = {
  run() {
    const made = new C39();
    all.push(made);
    return null;
  },
};
const step38 = {
  run() {
    const made = new C38();
    all.push(made);
    return step39;
  },
};
const step37 = {
  run() {
    const made = new C37();
    all.push(made);
    return step38;
  },
};
const step36 = {
  run() {
    const made = new C36();
    all.push(made);
    return step37;
  },
};
const step35 = {
  run() {
    const made = new C35();
    made.storedLate = "stored late";
    all.push(made);
    return step36;
  },
};
const step34 = {
  run() {
    const made = new C34();
    all.push(made);
    return step35;
  },
};
const step33 = {
  run() {
    const made = new C33();
    all.push(made);
    return step34;
  },
};
const step32 = {
  run() {
    const made = new C32();
    all.push(made);
    return step33;
  },
};
const step31 = {
  run() {
    const made = new C31();
    all.push(made);
    return step32;
  },
};
const step30 = {
  run() {
    const made = new C30();
    all.push(made);
    return step31;
  },
};
const step29 = {
  run() {
    const made = new C29();
    Object.assign(made, source);
    all.push(made);
    return step30;
  },
};
const step28 = {
  run() {
    const made = new C28();
    all.push(made);
    return step29;
  },
};
const step27 = {
  run() {
    const made = new C27();
    all.push(made);
    return step28;
  },
};
const step26 = {
  run() {
    const made = new C26();
    all.push(made);
    return step27;
  },
};
const step25 = {
  run() {
    const made = new C25();
    all.push(made);
    return step26;
  },
};
const step24 = {
  run() {
    const made = new C24();
    all.push(made);
    return step25;
  },
};
const step23 = {
  run() {
    const made = new C23();
    all.push(made);
    return step24;
  },
};
const step22 = {
  run() {
    const made = new C22();
    all.push(made);
    return step23;
  },
};
const step21 = {
  run() {
    const made = new C21();
    all.push(made);
    return step22;
  },
};
const step20 = {
  run() {
    const made = new C20();
    all.push(made);
    return step21;
  },
};
const step19 = {
  run() {
    const made = new C19();
    all.push(made);
    return step20;
  },
};
const step18 = {
  run() {
    const made = new C18();
    all.push(made);
    return step19;
  },
};
const step17 = {
  run() {
    const made = new C17();
    Object.setPrototypeOf(C17.prototype, late);
    all.push(made);
    return step18;
  },
};
const step16 = {
  run() {
    const made = new C16();
    all.push(made);
    return step17;
  },
};
const step15 = {
  run() {
    const made = new C15();
    all.push(made);
    return step16;
  },
};
const step14 = {
  run() {
    const made = new C14();
    all.push(made);
    return step15;
  },
};
const step13 = {
  run() {
    const made = new C13();
    all.push(made);
    return step14;
  },
};
const step12 = {
  run() {
    const made = new C12();
    all.push(made);
    return step13;
  },
};
const step11 = {
  run() {
    const made = new C11();
    made[keyOf("underKey")] = "computed key";
    all.push(made);
    return step12;
  },
};
const step10 = {
  run() {
    const made = new C10();
    all.push(made);
    return step11;
  },
};
const step9 = {
  run() {
    const made = new C9();
    all.push(made);
    return step10;
  },
};
const step8 = {
  run() {
    const made = new C8();
    all.push(made);
    return step9;
  },
};
const step7 = {
  run() {
    const made = new C7();
    all.push(made);
    return step8;
  },
};
const step6 = {
  run() {
    const made = new C6();
    all.push(made);
    return step7;
  },
};
const step5 = {
  run() {
    const made = new C5();
    all.push(made);
    return step6;
  },
};
const step4 = {
  run() {
    const made = new C4();
    all.push(made);
    return step5;
  },
};
const step3 = {
  run() {
    const made = new C3();
    all.push(made);
    return step4;
  },
};
const step2 = {
  run() {
    const made = new C2();
    all.push(made);
    return step3;
  },
};
const step1 = {
  run() {
    const made = new C1();
    all.push(made);
    return step2;
  },
};
const step0 = {
  run() {
    const made = new C0();
    all.push(made);
    return step1;
  },
};
let step = step0;
while (step) step = step.run();
const found = [];
for (const one of all) {
  const line = [];
  if (one.inherited !== undefined) line.push(one.inherited());
  if (one.computed !== undefined) line.push(one.computed);
  if (one.underKey0 !== undefined) line.push(one.underKey0);
  if (one.fromLatePrototype !== undefined) line.push(one.fromLatePrototype);
  if (one.copied !== undefined) line.push(one.copied);
  if (one.storedLate !== undefined) line.push(one.storedLate);
  if (one.own3 !== undefined) line.push(one.own3);
  if (one.onNothing !== undefined) line.push(one.onNothing);
  if (line.length) found.push(one.constructor.name + ": " + line.join(", "));
}
console.log(all.length);
console.log(found.join("\n"));
