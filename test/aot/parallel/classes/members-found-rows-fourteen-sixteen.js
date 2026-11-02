// Three rows of classes, each class made by a function of its own below the one before: 14, 16 and 40 classes long. Fields, methods, a setter and a getter of the
// uppermost class and a method that some classes override are found through the whole row, whatever its length.
class ShortBase {
  constructor() {
    this.kept = [];
  }
  set tally(value) {
    this.kept.push(value);
  }
  get tally() {
    return this.kept.length;
  }
  name() {
    return "short";
  }
}
function short0(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field0 = 0;
      this.tally = 0;
    }
    method0() {
      return this.field0 + 14;
    }
    name() {
      return super.name() + 0;
    }
  };
}
function short1(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field1 = 1;
      this.tally = 1;
    }
    method1() {
      return this.field1 + 14;
    }
  };
}
function short2(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field2 = 2;
      this.tally = 2;
    }
    method2() {
      return this.field2 + 14;
    }
  };
}
function short3(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field3 = 3;
      this.tally = 3;
    }
    method3() {
      return this.field3 + 14;
    }
  };
}
function short4(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field4 = 4;
      this.tally = 4;
    }
    method4() {
      return this.field4 + 14;
    }
  };
}
function short5(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field5 = 5;
      this.tally = 5;
    }
    method5() {
      return this.field5 + 14;
    }
    name() {
      return super.name() + 5;
    }
  };
}
function short6(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field6 = 6;
      this.tally = 6;
    }
    method6() {
      return this.field6 + 14;
    }
  };
}
function short7(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field7 = 7;
      this.tally = 7;
    }
    method7() {
      return this.field7 + 14;
    }
  };
}
function short8(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field8 = 8;
      this.tally = 8;
    }
    method8() {
      return this.field8 + 14;
    }
  };
}
function short9(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field9 = 9;
      this.tally = 9;
    }
    method9() {
      return this.field9 + 14;
    }
  };
}
function short10(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field10 = 10;
      this.tally = 10;
    }
    method10() {
      return this.field10 + 14;
    }
    name() {
      return super.name() + 10;
    }
  };
}
function short11(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field11 = 11;
      this.tally = 11;
    }
    method11() {
      return this.field11 + 14;
    }
  };
}
function short12(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field12 = 12;
      this.tally = 12;
    }
    method12() {
      return this.field12 + 14;
    }
  };
}
function short13(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field13 = 13;
      this.tally = 13;
    }
    method13() {
      return this.field13 + 14;
    }
  };
}
let Short = ShortBase;
Short = short0(Short);
Short = short1(Short);
Short = short2(Short);
Short = short3(Short);
Short = short4(Short);
Short = short5(Short);
Short = short6(Short);
Short = short7(Short);
Short = short8(Short);
Short = short9(Short);
Short = short10(Short);
Short = short11(Short);
Short = short12(Short);
Short = short13(Short);
class MiddleBase {
  constructor() {
    this.kept = [];
  }
  set tally(value) {
    this.kept.push(value);
  }
  get tally() {
    return this.kept.length;
  }
  name() {
    return "middle";
  }
}
function middle0(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field0 = 0;
      this.tally = 0;
    }
    method0() {
      return this.field0 + 16;
    }
    name() {
      return super.name() + 0;
    }
  };
}
function middle1(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field1 = 1;
      this.tally = 1;
    }
    method1() {
      return this.field1 + 16;
    }
  };
}
function middle2(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field2 = 2;
      this.tally = 2;
    }
    method2() {
      return this.field2 + 16;
    }
  };
}
function middle3(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field3 = 3;
      this.tally = 3;
    }
    method3() {
      return this.field3 + 16;
    }
  };
}
function middle4(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field4 = 4;
      this.tally = 4;
    }
    method4() {
      return this.field4 + 16;
    }
  };
}
function middle5(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field5 = 5;
      this.tally = 5;
    }
    method5() {
      return this.field5 + 16;
    }
    name() {
      return super.name() + 5;
    }
  };
}
function middle6(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field6 = 6;
      this.tally = 6;
    }
    method6() {
      return this.field6 + 16;
    }
  };
}
function middle7(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field7 = 7;
      this.tally = 7;
    }
    method7() {
      return this.field7 + 16;
    }
  };
}
function middle8(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field8 = 8;
      this.tally = 8;
    }
    method8() {
      return this.field8 + 16;
    }
  };
}
function middle9(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field9 = 9;
      this.tally = 9;
    }
    method9() {
      return this.field9 + 16;
    }
  };
}
function middle10(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field10 = 10;
      this.tally = 10;
    }
    method10() {
      return this.field10 + 16;
    }
    name() {
      return super.name() + 10;
    }
  };
}
function middle11(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field11 = 11;
      this.tally = 11;
    }
    method11() {
      return this.field11 + 16;
    }
  };
}
function middle12(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field12 = 12;
      this.tally = 12;
    }
    method12() {
      return this.field12 + 16;
    }
  };
}
function middle13(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field13 = 13;
      this.tally = 13;
    }
    method13() {
      return this.field13 + 16;
    }
  };
}
function middle14(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field14 = 14;
      this.tally = 14;
    }
    method14() {
      return this.field14 + 16;
    }
  };
}
function middle15(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field15 = 15;
      this.tally = 15;
    }
    method15() {
      return this.field15 + 16;
    }
    name() {
      return super.name() + 15;
    }
  };
}
let Middle = MiddleBase;
Middle = middle0(Middle);
Middle = middle1(Middle);
Middle = middle2(Middle);
Middle = middle3(Middle);
Middle = middle4(Middle);
Middle = middle5(Middle);
Middle = middle6(Middle);
Middle = middle7(Middle);
Middle = middle8(Middle);
Middle = middle9(Middle);
Middle = middle10(Middle);
Middle = middle11(Middle);
Middle = middle12(Middle);
Middle = middle13(Middle);
Middle = middle14(Middle);
Middle = middle15(Middle);
class LongBase {
  constructor() {
    this.kept = [];
  }
  set tally(value) {
    this.kept.push(value);
  }
  get tally() {
    return this.kept.length;
  }
  name() {
    return "long";
  }
}
function long0(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field0 = 0;
      this.tally = 0;
    }
    method0() {
      return this.field0 + 40;
    }
    name() {
      return super.name() + 0;
    }
  };
}
function long1(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field1 = 1;
      this.tally = 1;
    }
    method1() {
      return this.field1 + 40;
    }
  };
}
function long2(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field2 = 2;
      this.tally = 2;
    }
    method2() {
      return this.field2 + 40;
    }
  };
}
function long3(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field3 = 3;
      this.tally = 3;
    }
    method3() {
      return this.field3 + 40;
    }
  };
}
function long4(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field4 = 4;
      this.tally = 4;
    }
    method4() {
      return this.field4 + 40;
    }
  };
}
function long5(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field5 = 5;
      this.tally = 5;
    }
    method5() {
      return this.field5 + 40;
    }
    name() {
      return super.name() + 5;
    }
  };
}
function long6(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field6 = 6;
      this.tally = 6;
    }
    method6() {
      return this.field6 + 40;
    }
  };
}
function long7(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field7 = 7;
      this.tally = 7;
    }
    method7() {
      return this.field7 + 40;
    }
  };
}
function long8(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field8 = 8;
      this.tally = 8;
    }
    method8() {
      return this.field8 + 40;
    }
  };
}
function long9(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field9 = 9;
      this.tally = 9;
    }
    method9() {
      return this.field9 + 40;
    }
  };
}
function long10(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field10 = 10;
      this.tally = 10;
    }
    method10() {
      return this.field10 + 40;
    }
    name() {
      return super.name() + 10;
    }
  };
}
function long11(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field11 = 11;
      this.tally = 11;
    }
    method11() {
      return this.field11 + 40;
    }
  };
}
function long12(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field12 = 12;
      this.tally = 12;
    }
    method12() {
      return this.field12 + 40;
    }
  };
}
function long13(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field13 = 13;
      this.tally = 13;
    }
    method13() {
      return this.field13 + 40;
    }
  };
}
function long14(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field14 = 14;
      this.tally = 14;
    }
    method14() {
      return this.field14 + 40;
    }
  };
}
function long15(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field15 = 15;
      this.tally = 15;
    }
    method15() {
      return this.field15 + 40;
    }
    name() {
      return super.name() + 15;
    }
  };
}
function long16(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field16 = 16;
      this.tally = 16;
    }
    method16() {
      return this.field16 + 40;
    }
  };
}
function long17(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field17 = 17;
      this.tally = 17;
    }
    method17() {
      return this.field17 + 40;
    }
  };
}
function long18(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field18 = 18;
      this.tally = 18;
    }
    method18() {
      return this.field18 + 40;
    }
  };
}
function long19(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field19 = 19;
      this.tally = 19;
    }
    method19() {
      return this.field19 + 40;
    }
  };
}
function long20(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field20 = 20;
      this.tally = 20;
    }
    method20() {
      return this.field20 + 40;
    }
    name() {
      return super.name() + 20;
    }
  };
}
function long21(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field21 = 21;
      this.tally = 21;
    }
    method21() {
      return this.field21 + 40;
    }
  };
}
function long22(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field22 = 22;
      this.tally = 22;
    }
    method22() {
      return this.field22 + 40;
    }
  };
}
function long23(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field23 = 23;
      this.tally = 23;
    }
    method23() {
      return this.field23 + 40;
    }
  };
}
function long24(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field24 = 24;
      this.tally = 24;
    }
    method24() {
      return this.field24 + 40;
    }
  };
}
function long25(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field25 = 25;
      this.tally = 25;
    }
    method25() {
      return this.field25 + 40;
    }
    name() {
      return super.name() + 25;
    }
  };
}
function long26(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field26 = 26;
      this.tally = 26;
    }
    method26() {
      return this.field26 + 40;
    }
  };
}
function long27(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field27 = 27;
      this.tally = 27;
    }
    method27() {
      return this.field27 + 40;
    }
  };
}
function long28(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field28 = 28;
      this.tally = 28;
    }
    method28() {
      return this.field28 + 40;
    }
  };
}
function long29(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field29 = 29;
      this.tally = 29;
    }
    method29() {
      return this.field29 + 40;
    }
  };
}
function long30(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field30 = 30;
      this.tally = 30;
    }
    method30() {
      return this.field30 + 40;
    }
    name() {
      return super.name() + 30;
    }
  };
}
function long31(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field31 = 31;
      this.tally = 31;
    }
    method31() {
      return this.field31 + 40;
    }
  };
}
function long32(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field32 = 32;
      this.tally = 32;
    }
    method32() {
      return this.field32 + 40;
    }
  };
}
function long33(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field33 = 33;
      this.tally = 33;
    }
    method33() {
      return this.field33 + 40;
    }
  };
}
function long34(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field34 = 34;
      this.tally = 34;
    }
    method34() {
      return this.field34 + 40;
    }
  };
}
function long35(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field35 = 35;
      this.tally = 35;
    }
    method35() {
      return this.field35 + 40;
    }
    name() {
      return super.name() + 35;
    }
  };
}
function long36(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field36 = 36;
      this.tally = 36;
    }
    method36() {
      return this.field36 + 40;
    }
  };
}
function long37(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field37 = 37;
      this.tally = 37;
    }
    method37() {
      return this.field37 + 40;
    }
  };
}
function long38(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field38 = 38;
      this.tally = 38;
    }
    method38() {
      return this.field38 + 40;
    }
  };
}
function long39(Above) {
  return class extends Above {
    constructor() {
      super();
      this.field39 = 39;
      this.tally = 39;
    }
    method39() {
      return this.field39 + 40;
    }
  };
}
let Long = LongBase;
Long = long0(Long);
Long = long1(Long);
Long = long2(Long);
Long = long3(Long);
Long = long4(Long);
Long = long5(Long);
Long = long6(Long);
Long = long7(Long);
Long = long8(Long);
Long = long9(Long);
Long = long10(Long);
Long = long11(Long);
Long = long12(Long);
Long = long13(Long);
Long = long14(Long);
Long = long15(Long);
Long = long16(Long);
Long = long17(Long);
Long = long18(Long);
Long = long19(Long);
Long = long20(Long);
Long = long21(Long);
Long = long22(Long);
Long = long23(Long);
Long = long24(Long);
Long = long25(Long);
Long = long26(Long);
Long = long27(Long);
Long = long28(Long);
Long = long29(Long);
Long = long30(Long);
Long = long31(Long);
Long = long32(Long);
Long = long33(Long);
Long = long34(Long);
Long = long35(Long);
Long = long36(Long);
Long = long37(Long);
Long = long38(Long);
Long = long39(Long);
const shortObject = new Short();
let shortSum = 0;
shortSum += shortObject.field0 + shortObject.method0();
shortSum += shortObject.field1 + shortObject.method1();
shortSum += shortObject.field2 + shortObject.method2();
shortSum += shortObject.field3 + shortObject.method3();
shortSum += shortObject.field4 + shortObject.method4();
shortSum += shortObject.field5 + shortObject.method5();
shortSum += shortObject.field6 + shortObject.method6();
shortSum += shortObject.field7 + shortObject.method7();
shortSum += shortObject.field8 + shortObject.method8();
shortSum += shortObject.field9 + shortObject.method9();
shortSum += shortObject.field10 + shortObject.method10();
shortSum += shortObject.field11 + shortObject.method11();
shortSum += shortObject.field12 + shortObject.method12();
shortSum += shortObject.field13 + shortObject.method13();
console.log(shortSum, shortObject.tally, shortObject.kept.join(""), shortObject.name(), Object.keys(shortObject).length, "absent" in shortObject, shortObject.absent);
const middleObject = new Middle();
let middleSum = 0;
middleSum += middleObject.field0 + middleObject.method0();
middleSum += middleObject.field1 + middleObject.method1();
middleSum += middleObject.field2 + middleObject.method2();
middleSum += middleObject.field3 + middleObject.method3();
middleSum += middleObject.field4 + middleObject.method4();
middleSum += middleObject.field5 + middleObject.method5();
middleSum += middleObject.field6 + middleObject.method6();
middleSum += middleObject.field7 + middleObject.method7();
middleSum += middleObject.field8 + middleObject.method8();
middleSum += middleObject.field9 + middleObject.method9();
middleSum += middleObject.field10 + middleObject.method10();
middleSum += middleObject.field11 + middleObject.method11();
middleSum += middleObject.field12 + middleObject.method12();
middleSum += middleObject.field13 + middleObject.method13();
middleSum += middleObject.field14 + middleObject.method14();
middleSum += middleObject.field15 + middleObject.method15();
console.log(middleSum, middleObject.tally, middleObject.kept.join(""), middleObject.name(), Object.keys(middleObject).length, "absent" in middleObject, middleObject.absent);
const longObject = new Long();
let longSum = 0;
longSum += longObject.field0 + longObject.method0();
longSum += longObject.field1 + longObject.method1();
longSum += longObject.field2 + longObject.method2();
longSum += longObject.field3 + longObject.method3();
longSum += longObject.field4 + longObject.method4();
longSum += longObject.field5 + longObject.method5();
longSum += longObject.field6 + longObject.method6();
longSum += longObject.field7 + longObject.method7();
longSum += longObject.field8 + longObject.method8();
longSum += longObject.field9 + longObject.method9();
longSum += longObject.field10 + longObject.method10();
longSum += longObject.field11 + longObject.method11();
longSum += longObject.field12 + longObject.method12();
longSum += longObject.field13 + longObject.method13();
longSum += longObject.field14 + longObject.method14();
longSum += longObject.field15 + longObject.method15();
longSum += longObject.field16 + longObject.method16();
longSum += longObject.field17 + longObject.method17();
longSum += longObject.field18 + longObject.method18();
longSum += longObject.field19 + longObject.method19();
longSum += longObject.field20 + longObject.method20();
longSum += longObject.field21 + longObject.method21();
longSum += longObject.field22 + longObject.method22();
longSum += longObject.field23 + longObject.method23();
longSum += longObject.field24 + longObject.method24();
longSum += longObject.field25 + longObject.method25();
longSum += longObject.field26 + longObject.method26();
longSum += longObject.field27 + longObject.method27();
longSum += longObject.field28 + longObject.method28();
longSum += longObject.field29 + longObject.method29();
longSum += longObject.field30 + longObject.method30();
longSum += longObject.field31 + longObject.method31();
longSum += longObject.field32 + longObject.method32();
longSum += longObject.field33 + longObject.method33();
longSum += longObject.field34 + longObject.method34();
longSum += longObject.field35 + longObject.method35();
longSum += longObject.field36 + longObject.method36();
longSum += longObject.field37 + longObject.method37();
longSum += longObject.field38 + longObject.method38();
longSum += longObject.field39 + longObject.method39();
console.log(longSum, longObject.tally, longObject.kept.join(""), longObject.name(), Object.keys(longObject).length, "absent" in longObject, longObject.absent);
