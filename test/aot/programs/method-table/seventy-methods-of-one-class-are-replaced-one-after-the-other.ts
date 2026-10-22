// A class has seventy methods and its subclass overrides every second one: more members to watch than a word has bits. One function calls all seventy. Then each is replaced where it is defined, one after the other, and all seventy are called after every tenth.
class Wide {
  m00(): number {
    return 0;
  }
  m01(): number {
    return 1;
  }
  m02(): number {
    return 2;
  }
  m03(): number {
    return 3;
  }
  m04(): number {
    return 4;
  }
  m05(): number {
    return 5;
  }
  m06(): number {
    return 6;
  }
  m07(): number {
    return 7;
  }
  m08(): number {
    return 8;
  }
  m09(): number {
    return 9;
  }
  m10(): number {
    return 10;
  }
  m11(): number {
    return 11;
  }
  m12(): number {
    return 12;
  }
  m13(): number {
    return 13;
  }
  m14(): number {
    return 14;
  }
  m15(): number {
    return 15;
  }
  m16(): number {
    return 16;
  }
  m17(): number {
    return 17;
  }
  m18(): number {
    return 18;
  }
  m19(): number {
    return 19;
  }
  m20(): number {
    return 20;
  }
  m21(): number {
    return 21;
  }
  m22(): number {
    return 22;
  }
  m23(): number {
    return 23;
  }
  m24(): number {
    return 24;
  }
  m25(): number {
    return 25;
  }
  m26(): number {
    return 26;
  }
  m27(): number {
    return 27;
  }
  m28(): number {
    return 28;
  }
  m29(): number {
    return 29;
  }
  m30(): number {
    return 30;
  }
  m31(): number {
    return 31;
  }
  m32(): number {
    return 32;
  }
  m33(): number {
    return 33;
  }
  m34(): number {
    return 34;
  }
  m35(): number {
    return 35;
  }
  m36(): number {
    return 36;
  }
  m37(): number {
    return 37;
  }
  m38(): number {
    return 38;
  }
  m39(): number {
    return 39;
  }
  m40(): number {
    return 40;
  }
  m41(): number {
    return 41;
  }
  m42(): number {
    return 42;
  }
  m43(): number {
    return 43;
  }
  m44(): number {
    return 44;
  }
  m45(): number {
    return 45;
  }
  m46(): number {
    return 46;
  }
  m47(): number {
    return 47;
  }
  m48(): number {
    return 48;
  }
  m49(): number {
    return 49;
  }
  m50(): number {
    return 50;
  }
  m51(): number {
    return 51;
  }
  m52(): number {
    return 52;
  }
  m53(): number {
    return 53;
  }
  m54(): number {
    return 54;
  }
  m55(): number {
    return 55;
  }
  m56(): number {
    return 56;
  }
  m57(): number {
    return 57;
  }
  m58(): number {
    return 58;
  }
  m59(): number {
    return 59;
  }
  m60(): number {
    return 60;
  }
  m61(): number {
    return 61;
  }
  m62(): number {
    return 62;
  }
  m63(): number {
    return 63;
  }
  m64(): number {
    return 64;
  }
  m65(): number {
    return 65;
  }
  m66(): number {
    return 66;
  }
  m67(): number {
    return 67;
  }
  m68(): number {
    return 68;
  }
  m69(): number {
    return 69;
  }
}
class Wider extends Wide {
  m00(): number {
    return 1000;
  }
  m02(): number {
    return 1002;
  }
  m04(): number {
    return 1004;
  }
  m06(): number {
    return 1006;
  }
  m08(): number {
    return 1008;
  }
  m10(): number {
    return 1010;
  }
  m12(): number {
    return 1012;
  }
  m14(): number {
    return 1014;
  }
  m16(): number {
    return 1016;
  }
  m18(): number {
    return 1018;
  }
  m20(): number {
    return 1020;
  }
  m22(): number {
    return 1022;
  }
  m24(): number {
    return 1024;
  }
  m26(): number {
    return 1026;
  }
  m28(): number {
    return 1028;
  }
  m30(): number {
    return 1030;
  }
  m32(): number {
    return 1032;
  }
  m34(): number {
    return 1034;
  }
  m36(): number {
    return 1036;
  }
  m38(): number {
    return 1038;
  }
  m40(): number {
    return 1040;
  }
  m42(): number {
    return 1042;
  }
  m44(): number {
    return 1044;
  }
  m46(): number {
    return 1046;
  }
  m48(): number {
    return 1048;
  }
  m50(): number {
    return 1050;
  }
  m52(): number {
    return 1052;
  }
  m54(): number {
    return 1054;
  }
  m56(): number {
    return 1056;
  }
  m58(): number {
    return 1058;
  }
  m60(): number {
    return 1060;
  }
  m62(): number {
    return 1062;
  }
  m64(): number {
    return 1064;
  }
  m66(): number {
    return 1066;
  }
  m68(): number {
    return 1068;
  }
}

function callAll(x: Wide): number {
  let sum = 0;
  sum = (sum * 7 + x.m00()) % 1000003;
  sum = (sum * 7 + x.m01()) % 1000003;
  sum = (sum * 7 + x.m02()) % 1000003;
  sum = (sum * 7 + x.m03()) % 1000003;
  sum = (sum * 7 + x.m04()) % 1000003;
  sum = (sum * 7 + x.m05()) % 1000003;
  sum = (sum * 7 + x.m06()) % 1000003;
  sum = (sum * 7 + x.m07()) % 1000003;
  sum = (sum * 7 + x.m08()) % 1000003;
  sum = (sum * 7 + x.m09()) % 1000003;
  sum = (sum * 7 + x.m10()) % 1000003;
  sum = (sum * 7 + x.m11()) % 1000003;
  sum = (sum * 7 + x.m12()) % 1000003;
  sum = (sum * 7 + x.m13()) % 1000003;
  sum = (sum * 7 + x.m14()) % 1000003;
  sum = (sum * 7 + x.m15()) % 1000003;
  sum = (sum * 7 + x.m16()) % 1000003;
  sum = (sum * 7 + x.m17()) % 1000003;
  sum = (sum * 7 + x.m18()) % 1000003;
  sum = (sum * 7 + x.m19()) % 1000003;
  sum = (sum * 7 + x.m20()) % 1000003;
  sum = (sum * 7 + x.m21()) % 1000003;
  sum = (sum * 7 + x.m22()) % 1000003;
  sum = (sum * 7 + x.m23()) % 1000003;
  sum = (sum * 7 + x.m24()) % 1000003;
  sum = (sum * 7 + x.m25()) % 1000003;
  sum = (sum * 7 + x.m26()) % 1000003;
  sum = (sum * 7 + x.m27()) % 1000003;
  sum = (sum * 7 + x.m28()) % 1000003;
  sum = (sum * 7 + x.m29()) % 1000003;
  sum = (sum * 7 + x.m30()) % 1000003;
  sum = (sum * 7 + x.m31()) % 1000003;
  sum = (sum * 7 + x.m32()) % 1000003;
  sum = (sum * 7 + x.m33()) % 1000003;
  sum = (sum * 7 + x.m34()) % 1000003;
  sum = (sum * 7 + x.m35()) % 1000003;
  sum = (sum * 7 + x.m36()) % 1000003;
  sum = (sum * 7 + x.m37()) % 1000003;
  sum = (sum * 7 + x.m38()) % 1000003;
  sum = (sum * 7 + x.m39()) % 1000003;
  sum = (sum * 7 + x.m40()) % 1000003;
  sum = (sum * 7 + x.m41()) % 1000003;
  sum = (sum * 7 + x.m42()) % 1000003;
  sum = (sum * 7 + x.m43()) % 1000003;
  sum = (sum * 7 + x.m44()) % 1000003;
  sum = (sum * 7 + x.m45()) % 1000003;
  sum = (sum * 7 + x.m46()) % 1000003;
  sum = (sum * 7 + x.m47()) % 1000003;
  sum = (sum * 7 + x.m48()) % 1000003;
  sum = (sum * 7 + x.m49()) % 1000003;
  sum = (sum * 7 + x.m50()) % 1000003;
  sum = (sum * 7 + x.m51()) % 1000003;
  sum = (sum * 7 + x.m52()) % 1000003;
  sum = (sum * 7 + x.m53()) % 1000003;
  sum = (sum * 7 + x.m54()) % 1000003;
  sum = (sum * 7 + x.m55()) % 1000003;
  sum = (sum * 7 + x.m56()) % 1000003;
  sum = (sum * 7 + x.m57()) % 1000003;
  sum = (sum * 7 + x.m58()) % 1000003;
  sum = (sum * 7 + x.m59()) % 1000003;
  sum = (sum * 7 + x.m60()) % 1000003;
  sum = (sum * 7 + x.m61()) % 1000003;
  sum = (sum * 7 + x.m62()) % 1000003;
  sum = (sum * 7 + x.m63()) % 1000003;
  sum = (sum * 7 + x.m64()) % 1000003;
  sum = (sum * 7 + x.m65()) % 1000003;
  sum = (sum * 7 + x.m66()) % 1000003;
  sum = (sum * 7 + x.m67()) % 1000003;
  sum = (sum * 7 + x.m68()) % 1000003;
  sum = (sum * 7 + x.m69()) % 1000003;
  return sum;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const wide = new Wide();
const wider = new Wider();
note("the base at first", callAll(wide));
note("the subclass at first", callAll(wider));
Wider.prototype.m00 = () => 5000;
Wide.prototype.m00 = () => 6000;
Wide.prototype.m01 = () => 5001;
Wider.prototype.m02 = () => 5002;
Wide.prototype.m03 = () => 5003;
Wider.prototype.m04 = () => 5004;
Wide.prototype.m04 = () => 6004;
Wide.prototype.m05 = () => 5005;
Wider.prototype.m06 = () => 5006;
Wide.prototype.m07 = () => 5007;
Wider.prototype.m08 = () => 5008;
Wide.prototype.m08 = () => 6008;
Wide.prototype.m09 = () => 5009;
note("the base", callAll(wide));
note("the subclass", callAll(wider));
Wider.prototype.m10 = () => 5010;
Wide.prototype.m11 = () => 5011;
Wider.prototype.m12 = () => 5012;
Wide.prototype.m12 = () => 6012;
Wide.prototype.m13 = () => 5013;
Wider.prototype.m14 = () => 5014;
Wide.prototype.m15 = () => 5015;
Wider.prototype.m16 = () => 5016;
Wide.prototype.m16 = () => 6016;
Wide.prototype.m17 = () => 5017;
Wider.prototype.m18 = () => 5018;
Wide.prototype.m19 = () => 5019;
note("the base", callAll(wide));
note("the subclass", callAll(wider));
Wider.prototype.m20 = () => 5020;
Wide.prototype.m20 = () => 6020;
Wide.prototype.m21 = () => 5021;
Wider.prototype.m22 = () => 5022;
Wide.prototype.m23 = () => 5023;
Wider.prototype.m24 = () => 5024;
Wide.prototype.m24 = () => 6024;
Wide.prototype.m25 = () => 5025;
Wider.prototype.m26 = () => 5026;
Wide.prototype.m27 = () => 5027;
Wider.prototype.m28 = () => 5028;
Wide.prototype.m28 = () => 6028;
Wide.prototype.m29 = () => 5029;
note("the base", callAll(wide));
note("the subclass", callAll(wider));
Wider.prototype.m30 = () => 5030;
Wide.prototype.m31 = () => 5031;
Wider.prototype.m32 = () => 5032;
Wide.prototype.m32 = () => 6032;
Wide.prototype.m33 = () => 5033;
Wider.prototype.m34 = () => 5034;
Wide.prototype.m35 = () => 5035;
Wider.prototype.m36 = () => 5036;
Wide.prototype.m36 = () => 6036;
Wide.prototype.m37 = () => 5037;
Wider.prototype.m38 = () => 5038;
Wide.prototype.m39 = () => 5039;
note("the base", callAll(wide));
note("the subclass", callAll(wider));
Wider.prototype.m40 = () => 5040;
Wide.prototype.m40 = () => 6040;
Wide.prototype.m41 = () => 5041;
Wider.prototype.m42 = () => 5042;
Wide.prototype.m43 = () => 5043;
Wider.prototype.m44 = () => 5044;
Wide.prototype.m44 = () => 6044;
Wide.prototype.m45 = () => 5045;
Wider.prototype.m46 = () => 5046;
Wide.prototype.m47 = () => 5047;
Wider.prototype.m48 = () => 5048;
Wide.prototype.m48 = () => 6048;
Wide.prototype.m49 = () => 5049;
note("the base", callAll(wide));
note("the subclass", callAll(wider));
Wider.prototype.m50 = () => 5050;
Wide.prototype.m51 = () => 5051;
Wider.prototype.m52 = () => 5052;
Wide.prototype.m52 = () => 6052;
Wide.prototype.m53 = () => 5053;
Wider.prototype.m54 = () => 5054;
Wide.prototype.m55 = () => 5055;
Wider.prototype.m56 = () => 5056;
Wide.prototype.m56 = () => 6056;
Wide.prototype.m57 = () => 5057;
Wider.prototype.m58 = () => 5058;
Wide.prototype.m59 = () => 5059;
note("the base", callAll(wide));
note("the subclass", callAll(wider));
Wider.prototype.m60 = () => 5060;
Wide.prototype.m60 = () => 6060;
Wide.prototype.m61 = () => 5061;
Wider.prototype.m62 = () => 5062;
Wide.prototype.m63 = () => 5063;
Wider.prototype.m64 = () => 5064;
Wide.prototype.m64 = () => 6064;
Wide.prototype.m65 = () => 5065;
Wider.prototype.m66 = () => 5066;
Wide.prototype.m67 = () => 5067;
Wider.prototype.m68 = () => 5068;
Wide.prototype.m68 = () => 6068;
Wide.prototype.m69 = () => 5069;
note("the base", callAll(wide));
note("the subclass", callAll(wider));

export {};
