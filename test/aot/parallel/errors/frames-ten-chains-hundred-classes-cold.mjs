// Ten chains of 100 functions and classes that call and construct each other. Each chain makes an error at its end, with no limit on the number of frames, twice.
// Each line prints the names and the places of all frames.
// Flags: --aot-heat=everything-is-cold
Error.stackTraceLimit = Infinity;
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/\(?[^ (]*\.mjs:/, "(")
        .replace(/^\((\d+:\d+)$/, "($1)"),
    )
    .join(" < ");
let made = 0;
function a0() {
  made++;
  return frames(new Error("a"));
}
class A1Base {
  constructor() {
    this.text = a0();
  }
}
class A1 extends A1Base {}
function a1() {
  return new A1().text;
}
class A2 {
  constructor() {
    this.text = a1();
  }
}
function a2() {
  return new A2().text;
}
function A3() {
  return { text: a2() };
}
function a3() {
  return new A3().text;
}
class A4 {
  constructor() {
    this.text = a3();
  }
}
function a4() {
  return new A4().text;
}
function a5Holder() {
  return { text: a4() };
}
function A5() {
  return a5Holder();
}
function a5() {
  return new A5().text;
}
function a6Holder() {
  return { text: a5() };
}
function A6() {
  this.level = 6;
  return a6Holder();
}
function a6() {
  return (made & 1 ? new A6() : A6.call({})).text;
}
class A7 {
  constructor() {
    this.text = a6();
  }
}
function a7() {
  return new A7().text;
}
class A8Base {
  constructor() {
    this.text = a7();
  }
}
class A8 extends A8Base {}
function a8() {
  return new A8().text;
}
class A9 {
  constructor() {
    this.text = a8();
  }
}
function a9() {
  return new A9().text;
}
function A10() {
  return { text: a9() };
}
function a10() {
  return new A10().text;
}
class A11 {
  constructor() {
    this.text = a10();
  }
}
function a11() {
  return new A11().text;
}
function a12Holder() {
  return { text: a11() };
}
function A12() {
  return a12Holder();
}
function a12() {
  return new A12().text;
}
function a13Holder() {
  return { text: a12() };
}
function A13() {
  this.level = 13;
  return a13Holder();
}
function a13() {
  return (made & 1 ? new A13() : A13.call({})).text;
}
class A14 {
  constructor() {
    this.text = a13();
  }
}
function a14() {
  return new A14().text;
}
class A15Base {
  constructor() {
    this.text = a14();
  }
}
class A15 extends A15Base {}
function a15() {
  return new A15().text;
}
class A16 {
  constructor() {
    this.text = a15();
  }
}
function a16() {
  return new A16().text;
}
function A17() {
  return { text: a16() };
}
function a17() {
  return new A17().text;
}
class A18 {
  constructor() {
    this.text = a17();
  }
}
function a18() {
  return new A18().text;
}
function a19Holder() {
  return { text: a18() };
}
function A19() {
  return a19Holder();
}
function a19() {
  return new A19().text;
}
function a20Holder() {
  return { text: a19() };
}
function A20() {
  this.level = 20;
  return a20Holder();
}
function a20() {
  return (made & 1 ? new A20() : A20.call({})).text;
}
class A21 {
  constructor() {
    this.text = a20();
  }
}
function a21() {
  return new A21().text;
}
class A22Base {
  constructor() {
    this.text = a21();
  }
}
class A22 extends A22Base {}
function a22() {
  return new A22().text;
}
class A23 {
  constructor() {
    this.text = a22();
  }
}
function a23() {
  return new A23().text;
}
function A24() {
  return { text: a23() };
}
function a24() {
  return new A24().text;
}
class A25 {
  constructor() {
    this.text = a24();
  }
}
function a25() {
  return new A25().text;
}
function a26Holder() {
  return { text: a25() };
}
function A26() {
  return a26Holder();
}
function a26() {
  return new A26().text;
}
function a27Holder() {
  return { text: a26() };
}
function A27() {
  this.level = 27;
  return a27Holder();
}
function a27() {
  return (made & 1 ? new A27() : A27.call({})).text;
}
class A28 {
  constructor() {
    this.text = a27();
  }
}
function a28() {
  return new A28().text;
}
class A29Base {
  constructor() {
    this.text = a28();
  }
}
class A29 extends A29Base {}
function a29() {
  return new A29().text;
}
class A30 {
  constructor() {
    this.text = a29();
  }
}
function a30() {
  return new A30().text;
}
function A31() {
  return { text: a30() };
}
function a31() {
  return new A31().text;
}
class A32 {
  constructor() {
    this.text = a31();
  }
}
function a32() {
  return new A32().text;
}
function a33Holder() {
  return { text: a32() };
}
function A33() {
  return a33Holder();
}
function a33() {
  return new A33().text;
}
function a34Holder() {
  return { text: a33() };
}
function A34() {
  this.level = 34;
  return a34Holder();
}
function a34() {
  return (made & 1 ? new A34() : A34.call({})).text;
}
class A35 {
  constructor() {
    this.text = a34();
  }
}
function a35() {
  return new A35().text;
}
class A36Base {
  constructor() {
    this.text = a35();
  }
}
class A36 extends A36Base {}
function a36() {
  return new A36().text;
}
class A37 {
  constructor() {
    this.text = a36();
  }
}
function a37() {
  return new A37().text;
}
function A38() {
  return { text: a37() };
}
function a38() {
  return new A38().text;
}
class A39 {
  constructor() {
    this.text = a38();
  }
}
function a39() {
  return new A39().text;
}
function a40Holder() {
  return { text: a39() };
}
function A40() {
  return a40Holder();
}
function a40() {
  return new A40().text;
}
function a41Holder() {
  return { text: a40() };
}
function A41() {
  this.level = 41;
  return a41Holder();
}
function a41() {
  return (made & 1 ? new A41() : A41.call({})).text;
}
class A42 {
  constructor() {
    this.text = a41();
  }
}
function a42() {
  return new A42().text;
}
class A43Base {
  constructor() {
    this.text = a42();
  }
}
class A43 extends A43Base {}
function a43() {
  return new A43().text;
}
class A44 {
  constructor() {
    this.text = a43();
  }
}
function a44() {
  return new A44().text;
}
function A45() {
  return { text: a44() };
}
function a45() {
  return new A45().text;
}
class A46 {
  constructor() {
    this.text = a45();
  }
}
function a46() {
  return new A46().text;
}
function a47Holder() {
  return { text: a46() };
}
function A47() {
  return a47Holder();
}
function a47() {
  return new A47().text;
}
function a48Holder() {
  return { text: a47() };
}
function A48() {
  this.level = 48;
  return a48Holder();
}
function a48() {
  return (made & 1 ? new A48() : A48.call({})).text;
}
class A49 {
  constructor() {
    this.text = a48();
  }
}
function a49() {
  return new A49().text;
}
class A50Base {
  constructor() {
    this.text = a49();
  }
}
class A50 extends A50Base {}
function a50() {
  return new A50().text;
}
class A51 {
  constructor() {
    this.text = a50();
  }
}
function a51() {
  return new A51().text;
}
function A52() {
  return { text: a51() };
}
function a52() {
  return new A52().text;
}
class A53 {
  constructor() {
    this.text = a52();
  }
}
function a53() {
  return new A53().text;
}
function a54Holder() {
  return { text: a53() };
}
function A54() {
  return a54Holder();
}
function a54() {
  return new A54().text;
}
function a55Holder() {
  return { text: a54() };
}
function A55() {
  this.level = 55;
  return a55Holder();
}
function a55() {
  return (made & 1 ? new A55() : A55.call({})).text;
}
class A56 {
  constructor() {
    this.text = a55();
  }
}
function a56() {
  return new A56().text;
}
class A57Base {
  constructor() {
    this.text = a56();
  }
}
class A57 extends A57Base {}
function a57() {
  return new A57().text;
}
class A58 {
  constructor() {
    this.text = a57();
  }
}
function a58() {
  return new A58().text;
}
function A59() {
  return { text: a58() };
}
function a59() {
  return new A59().text;
}
class A60 {
  constructor() {
    this.text = a59();
  }
}
function a60() {
  return new A60().text;
}
function a61Holder() {
  return { text: a60() };
}
function A61() {
  return a61Holder();
}
function a61() {
  return new A61().text;
}
function a62Holder() {
  return { text: a61() };
}
function A62() {
  this.level = 62;
  return a62Holder();
}
function a62() {
  return (made & 1 ? new A62() : A62.call({})).text;
}
class A63 {
  constructor() {
    this.text = a62();
  }
}
function a63() {
  return new A63().text;
}
class A64Base {
  constructor() {
    this.text = a63();
  }
}
class A64 extends A64Base {}
function a64() {
  return new A64().text;
}
class A65 {
  constructor() {
    this.text = a64();
  }
}
function a65() {
  return new A65().text;
}
function A66() {
  return { text: a65() };
}
function a66() {
  return new A66().text;
}
class A67 {
  constructor() {
    this.text = a66();
  }
}
function a67() {
  return new A67().text;
}
function a68Holder() {
  return { text: a67() };
}
function A68() {
  return a68Holder();
}
function a68() {
  return new A68().text;
}
function a69Holder() {
  return { text: a68() };
}
function A69() {
  this.level = 69;
  return a69Holder();
}
function a69() {
  return (made & 1 ? new A69() : A69.call({})).text;
}
class A70 {
  constructor() {
    this.text = a69();
  }
}
function a70() {
  return new A70().text;
}
class A71Base {
  constructor() {
    this.text = a70();
  }
}
class A71 extends A71Base {}
function a71() {
  return new A71().text;
}
class A72 {
  constructor() {
    this.text = a71();
  }
}
function a72() {
  return new A72().text;
}
function A73() {
  return { text: a72() };
}
function a73() {
  return new A73().text;
}
class A74 {
  constructor() {
    this.text = a73();
  }
}
function a74() {
  return new A74().text;
}
function a75Holder() {
  return { text: a74() };
}
function A75() {
  return a75Holder();
}
function a75() {
  return new A75().text;
}
function a76Holder() {
  return { text: a75() };
}
function A76() {
  this.level = 76;
  return a76Holder();
}
function a76() {
  return (made & 1 ? new A76() : A76.call({})).text;
}
class A77 {
  constructor() {
    this.text = a76();
  }
}
function a77() {
  return new A77().text;
}
class A78Base {
  constructor() {
    this.text = a77();
  }
}
class A78 extends A78Base {}
function a78() {
  return new A78().text;
}
class A79 {
  constructor() {
    this.text = a78();
  }
}
function a79() {
  return new A79().text;
}
function A80() {
  return { text: a79() };
}
function a80() {
  return new A80().text;
}
class A81 {
  constructor() {
    this.text = a80();
  }
}
function a81() {
  return new A81().text;
}
function a82Holder() {
  return { text: a81() };
}
function A82() {
  return a82Holder();
}
function a82() {
  return new A82().text;
}
function a83Holder() {
  return { text: a82() };
}
function A83() {
  this.level = 83;
  return a83Holder();
}
function a83() {
  return (made & 1 ? new A83() : A83.call({})).text;
}
class A84 {
  constructor() {
    this.text = a83();
  }
}
function a84() {
  return new A84().text;
}
class A85Base {
  constructor() {
    this.text = a84();
  }
}
class A85 extends A85Base {}
function a85() {
  return new A85().text;
}
class A86 {
  constructor() {
    this.text = a85();
  }
}
function a86() {
  return new A86().text;
}
function A87() {
  return { text: a86() };
}
function a87() {
  return new A87().text;
}
class A88 {
  constructor() {
    this.text = a87();
  }
}
function a88() {
  return new A88().text;
}
function a89Holder() {
  return { text: a88() };
}
function A89() {
  return a89Holder();
}
function a89() {
  return new A89().text;
}
function a90Holder() {
  return { text: a89() };
}
function A90() {
  this.level = 90;
  return a90Holder();
}
function a90() {
  return (made & 1 ? new A90() : A90.call({})).text;
}
class A91 {
  constructor() {
    this.text = a90();
  }
}
function a91() {
  return new A91().text;
}
class A92Base {
  constructor() {
    this.text = a91();
  }
}
class A92 extends A92Base {}
function a92() {
  return new A92().text;
}
class A93 {
  constructor() {
    this.text = a92();
  }
}
function a93() {
  return new A93().text;
}
function A94() {
  return { text: a93() };
}
function a94() {
  return new A94().text;
}
class A95 {
  constructor() {
    this.text = a94();
  }
}
function a95() {
  return new A95().text;
}
function a96Holder() {
  return { text: a95() };
}
function A96() {
  return a96Holder();
}
function a96() {
  return new A96().text;
}
function a97Holder() {
  return { text: a96() };
}
function A97() {
  this.level = 97;
  return a97Holder();
}
function a97() {
  return (made & 1 ? new A97() : A97.call({})).text;
}
class A98 {
  constructor() {
    this.text = a97();
  }
}
function a98() {
  return new A98().text;
}
class A99Base {
  constructor() {
    this.text = a98();
  }
}
class A99 extends A99Base {}
function a99() {
  return new A99().text;
}
class A100 {
  constructor() {
    this.text = a99();
  }
}
function a100() {
  return new A100().text;
}
function b0() {
  made++;
  return frames(new Error("b"));
}
class B1 {
  constructor() {
    this.text = b0();
  }
}
function b1() {
  return new B1().text;
}
function B2() {
  return { text: b1() };
}
function b2() {
  return new B2().text;
}
class B3 {
  constructor() {
    this.text = b2();
  }
}
function b3() {
  return new B3().text;
}
function b4Holder() {
  return { text: b3() };
}
function B4() {
  return b4Holder();
}
function b4() {
  return new B4().text;
}
function b5Holder() {
  return { text: b4() };
}
function B5() {
  this.level = 5;
  return b5Holder();
}
function b5() {
  return (made & 1 ? new B5() : B5.call({})).text;
}
class B6 {
  constructor() {
    this.text = b5();
  }
}
function b6() {
  return new B6().text;
}
class B7Base {
  constructor() {
    this.text = b6();
  }
}
class B7 extends B7Base {}
function b7() {
  return new B7().text;
}
class B8 {
  constructor() {
    this.text = b7();
  }
}
function b8() {
  return new B8().text;
}
function B9() {
  return { text: b8() };
}
function b9() {
  return new B9().text;
}
class B10 {
  constructor() {
    this.text = b9();
  }
}
function b10() {
  return new B10().text;
}
function b11Holder() {
  return { text: b10() };
}
function B11() {
  return b11Holder();
}
function b11() {
  return new B11().text;
}
function b12Holder() {
  return { text: b11() };
}
function B12() {
  this.level = 12;
  return b12Holder();
}
function b12() {
  return (made & 1 ? new B12() : B12.call({})).text;
}
class B13 {
  constructor() {
    this.text = b12();
  }
}
function b13() {
  return new B13().text;
}
class B14Base {
  constructor() {
    this.text = b13();
  }
}
class B14 extends B14Base {}
function b14() {
  return new B14().text;
}
class B15 {
  constructor() {
    this.text = b14();
  }
}
function b15() {
  return new B15().text;
}
function B16() {
  return { text: b15() };
}
function b16() {
  return new B16().text;
}
class B17 {
  constructor() {
    this.text = b16();
  }
}
function b17() {
  return new B17().text;
}
function b18Holder() {
  return { text: b17() };
}
function B18() {
  return b18Holder();
}
function b18() {
  return new B18().text;
}
function b19Holder() {
  return { text: b18() };
}
function B19() {
  this.level = 19;
  return b19Holder();
}
function b19() {
  return (made & 1 ? new B19() : B19.call({})).text;
}
class B20 {
  constructor() {
    this.text = b19();
  }
}
function b20() {
  return new B20().text;
}
class B21Base {
  constructor() {
    this.text = b20();
  }
}
class B21 extends B21Base {}
function b21() {
  return new B21().text;
}
class B22 {
  constructor() {
    this.text = b21();
  }
}
function b22() {
  return new B22().text;
}
function B23() {
  return { text: b22() };
}
function b23() {
  return new B23().text;
}
class B24 {
  constructor() {
    this.text = b23();
  }
}
function b24() {
  return new B24().text;
}
function b25Holder() {
  return { text: b24() };
}
function B25() {
  return b25Holder();
}
function b25() {
  return new B25().text;
}
function b26Holder() {
  return { text: b25() };
}
function B26() {
  this.level = 26;
  return b26Holder();
}
function b26() {
  return (made & 1 ? new B26() : B26.call({})).text;
}
class B27 {
  constructor() {
    this.text = b26();
  }
}
function b27() {
  return new B27().text;
}
class B28Base {
  constructor() {
    this.text = b27();
  }
}
class B28 extends B28Base {}
function b28() {
  return new B28().text;
}
class B29 {
  constructor() {
    this.text = b28();
  }
}
function b29() {
  return new B29().text;
}
function B30() {
  return { text: b29() };
}
function b30() {
  return new B30().text;
}
class B31 {
  constructor() {
    this.text = b30();
  }
}
function b31() {
  return new B31().text;
}
function b32Holder() {
  return { text: b31() };
}
function B32() {
  return b32Holder();
}
function b32() {
  return new B32().text;
}
function b33Holder() {
  return { text: b32() };
}
function B33() {
  this.level = 33;
  return b33Holder();
}
function b33() {
  return (made & 1 ? new B33() : B33.call({})).text;
}
class B34 {
  constructor() {
    this.text = b33();
  }
}
function b34() {
  return new B34().text;
}
class B35Base {
  constructor() {
    this.text = b34();
  }
}
class B35 extends B35Base {}
function b35() {
  return new B35().text;
}
class B36 {
  constructor() {
    this.text = b35();
  }
}
function b36() {
  return new B36().text;
}
function B37() {
  return { text: b36() };
}
function b37() {
  return new B37().text;
}
class B38 {
  constructor() {
    this.text = b37();
  }
}
function b38() {
  return new B38().text;
}
function b39Holder() {
  return { text: b38() };
}
function B39() {
  return b39Holder();
}
function b39() {
  return new B39().text;
}
function b40Holder() {
  return { text: b39() };
}
function B40() {
  this.level = 40;
  return b40Holder();
}
function b40() {
  return (made & 1 ? new B40() : B40.call({})).text;
}
class B41 {
  constructor() {
    this.text = b40();
  }
}
function b41() {
  return new B41().text;
}
class B42Base {
  constructor() {
    this.text = b41();
  }
}
class B42 extends B42Base {}
function b42() {
  return new B42().text;
}
class B43 {
  constructor() {
    this.text = b42();
  }
}
function b43() {
  return new B43().text;
}
function B44() {
  return { text: b43() };
}
function b44() {
  return new B44().text;
}
class B45 {
  constructor() {
    this.text = b44();
  }
}
function b45() {
  return new B45().text;
}
function b46Holder() {
  return { text: b45() };
}
function B46() {
  return b46Holder();
}
function b46() {
  return new B46().text;
}
function b47Holder() {
  return { text: b46() };
}
function B47() {
  this.level = 47;
  return b47Holder();
}
function b47() {
  return (made & 1 ? new B47() : B47.call({})).text;
}
class B48 {
  constructor() {
    this.text = b47();
  }
}
function b48() {
  return new B48().text;
}
class B49Base {
  constructor() {
    this.text = b48();
  }
}
class B49 extends B49Base {}
function b49() {
  return new B49().text;
}
class B50 {
  constructor() {
    this.text = b49();
  }
}
function b50() {
  return new B50().text;
}
function B51() {
  return { text: b50() };
}
function b51() {
  return new B51().text;
}
class B52 {
  constructor() {
    this.text = b51();
  }
}
function b52() {
  return new B52().text;
}
function b53Holder() {
  return { text: b52() };
}
function B53() {
  return b53Holder();
}
function b53() {
  return new B53().text;
}
function b54Holder() {
  return { text: b53() };
}
function B54() {
  this.level = 54;
  return b54Holder();
}
function b54() {
  return (made & 1 ? new B54() : B54.call({})).text;
}
class B55 {
  constructor() {
    this.text = b54();
  }
}
function b55() {
  return new B55().text;
}
class B56Base {
  constructor() {
    this.text = b55();
  }
}
class B56 extends B56Base {}
function b56() {
  return new B56().text;
}
class B57 {
  constructor() {
    this.text = b56();
  }
}
function b57() {
  return new B57().text;
}
function B58() {
  return { text: b57() };
}
function b58() {
  return new B58().text;
}
class B59 {
  constructor() {
    this.text = b58();
  }
}
function b59() {
  return new B59().text;
}
function b60Holder() {
  return { text: b59() };
}
function B60() {
  return b60Holder();
}
function b60() {
  return new B60().text;
}
function b61Holder() {
  return { text: b60() };
}
function B61() {
  this.level = 61;
  return b61Holder();
}
function b61() {
  return (made & 1 ? new B61() : B61.call({})).text;
}
class B62 {
  constructor() {
    this.text = b61();
  }
}
function b62() {
  return new B62().text;
}
class B63Base {
  constructor() {
    this.text = b62();
  }
}
class B63 extends B63Base {}
function b63() {
  return new B63().text;
}
class B64 {
  constructor() {
    this.text = b63();
  }
}
function b64() {
  return new B64().text;
}
function B65() {
  return { text: b64() };
}
function b65() {
  return new B65().text;
}
class B66 {
  constructor() {
    this.text = b65();
  }
}
function b66() {
  return new B66().text;
}
function b67Holder() {
  return { text: b66() };
}
function B67() {
  return b67Holder();
}
function b67() {
  return new B67().text;
}
function b68Holder() {
  return { text: b67() };
}
function B68() {
  this.level = 68;
  return b68Holder();
}
function b68() {
  return (made & 1 ? new B68() : B68.call({})).text;
}
class B69 {
  constructor() {
    this.text = b68();
  }
}
function b69() {
  return new B69().text;
}
class B70Base {
  constructor() {
    this.text = b69();
  }
}
class B70 extends B70Base {}
function b70() {
  return new B70().text;
}
class B71 {
  constructor() {
    this.text = b70();
  }
}
function b71() {
  return new B71().text;
}
function B72() {
  return { text: b71() };
}
function b72() {
  return new B72().text;
}
class B73 {
  constructor() {
    this.text = b72();
  }
}
function b73() {
  return new B73().text;
}
function b74Holder() {
  return { text: b73() };
}
function B74() {
  return b74Holder();
}
function b74() {
  return new B74().text;
}
function b75Holder() {
  return { text: b74() };
}
function B75() {
  this.level = 75;
  return b75Holder();
}
function b75() {
  return (made & 1 ? new B75() : B75.call({})).text;
}
class B76 {
  constructor() {
    this.text = b75();
  }
}
function b76() {
  return new B76().text;
}
class B77Base {
  constructor() {
    this.text = b76();
  }
}
class B77 extends B77Base {}
function b77() {
  return new B77().text;
}
class B78 {
  constructor() {
    this.text = b77();
  }
}
function b78() {
  return new B78().text;
}
function B79() {
  return { text: b78() };
}
function b79() {
  return new B79().text;
}
class B80 {
  constructor() {
    this.text = b79();
  }
}
function b80() {
  return new B80().text;
}
function b81Holder() {
  return { text: b80() };
}
function B81() {
  return b81Holder();
}
function b81() {
  return new B81().text;
}
function b82Holder() {
  return { text: b81() };
}
function B82() {
  this.level = 82;
  return b82Holder();
}
function b82() {
  return (made & 1 ? new B82() : B82.call({})).text;
}
class B83 {
  constructor() {
    this.text = b82();
  }
}
function b83() {
  return new B83().text;
}
class B84Base {
  constructor() {
    this.text = b83();
  }
}
class B84 extends B84Base {}
function b84() {
  return new B84().text;
}
class B85 {
  constructor() {
    this.text = b84();
  }
}
function b85() {
  return new B85().text;
}
function B86() {
  return { text: b85() };
}
function b86() {
  return new B86().text;
}
class B87 {
  constructor() {
    this.text = b86();
  }
}
function b87() {
  return new B87().text;
}
function b88Holder() {
  return { text: b87() };
}
function B88() {
  return b88Holder();
}
function b88() {
  return new B88().text;
}
function b89Holder() {
  return { text: b88() };
}
function B89() {
  this.level = 89;
  return b89Holder();
}
function b89() {
  return (made & 1 ? new B89() : B89.call({})).text;
}
class B90 {
  constructor() {
    this.text = b89();
  }
}
function b90() {
  return new B90().text;
}
class B91Base {
  constructor() {
    this.text = b90();
  }
}
class B91 extends B91Base {}
function b91() {
  return new B91().text;
}
class B92 {
  constructor() {
    this.text = b91();
  }
}
function b92() {
  return new B92().text;
}
function B93() {
  return { text: b92() };
}
function b93() {
  return new B93().text;
}
class B94 {
  constructor() {
    this.text = b93();
  }
}
function b94() {
  return new B94().text;
}
function b95Holder() {
  return { text: b94() };
}
function B95() {
  return b95Holder();
}
function b95() {
  return new B95().text;
}
function b96Holder() {
  return { text: b95() };
}
function B96() {
  this.level = 96;
  return b96Holder();
}
function b96() {
  return (made & 1 ? new B96() : B96.call({})).text;
}
class B97 {
  constructor() {
    this.text = b96();
  }
}
function b97() {
  return new B97().text;
}
class B98Base {
  constructor() {
    this.text = b97();
  }
}
class B98 extends B98Base {}
function b98() {
  return new B98().text;
}
class B99 {
  constructor() {
    this.text = b98();
  }
}
function b99() {
  return new B99().text;
}
function B100() {
  return { text: b99() };
}
function b100() {
  return new B100().text;
}
function c0() {
  made++;
  return frames(new Error("c"));
}
function C1() {
  return { text: c0() };
}
function c1() {
  return new C1().text;
}
class C2 {
  constructor() {
    this.text = c1();
  }
}
function c2() {
  return new C2().text;
}
function c3Holder() {
  return { text: c2() };
}
function C3() {
  return c3Holder();
}
function c3() {
  return new C3().text;
}
function c4Holder() {
  return { text: c3() };
}
function C4() {
  this.level = 4;
  return c4Holder();
}
function c4() {
  return (made & 1 ? new C4() : C4.call({})).text;
}
class C5 {
  constructor() {
    this.text = c4();
  }
}
function c5() {
  return new C5().text;
}
class C6Base {
  constructor() {
    this.text = c5();
  }
}
class C6 extends C6Base {}
function c6() {
  return new C6().text;
}
class C7 {
  constructor() {
    this.text = c6();
  }
}
function c7() {
  return new C7().text;
}
function C8() {
  return { text: c7() };
}
function c8() {
  return new C8().text;
}
class C9 {
  constructor() {
    this.text = c8();
  }
}
function c9() {
  return new C9().text;
}
function c10Holder() {
  return { text: c9() };
}
function C10() {
  return c10Holder();
}
function c10() {
  return new C10().text;
}
function c11Holder() {
  return { text: c10() };
}
function C11() {
  this.level = 11;
  return c11Holder();
}
function c11() {
  return (made & 1 ? new C11() : C11.call({})).text;
}
class C12 {
  constructor() {
    this.text = c11();
  }
}
function c12() {
  return new C12().text;
}
class C13Base {
  constructor() {
    this.text = c12();
  }
}
class C13 extends C13Base {}
function c13() {
  return new C13().text;
}
class C14 {
  constructor() {
    this.text = c13();
  }
}
function c14() {
  return new C14().text;
}
function C15() {
  return { text: c14() };
}
function c15() {
  return new C15().text;
}
class C16 {
  constructor() {
    this.text = c15();
  }
}
function c16() {
  return new C16().text;
}
function c17Holder() {
  return { text: c16() };
}
function C17() {
  return c17Holder();
}
function c17() {
  return new C17().text;
}
function c18Holder() {
  return { text: c17() };
}
function C18() {
  this.level = 18;
  return c18Holder();
}
function c18() {
  return (made & 1 ? new C18() : C18.call({})).text;
}
class C19 {
  constructor() {
    this.text = c18();
  }
}
function c19() {
  return new C19().text;
}
class C20Base {
  constructor() {
    this.text = c19();
  }
}
class C20 extends C20Base {}
function c20() {
  return new C20().text;
}
class C21 {
  constructor() {
    this.text = c20();
  }
}
function c21() {
  return new C21().text;
}
function C22() {
  return { text: c21() };
}
function c22() {
  return new C22().text;
}
class C23 {
  constructor() {
    this.text = c22();
  }
}
function c23() {
  return new C23().text;
}
function c24Holder() {
  return { text: c23() };
}
function C24() {
  return c24Holder();
}
function c24() {
  return new C24().text;
}
function c25Holder() {
  return { text: c24() };
}
function C25() {
  this.level = 25;
  return c25Holder();
}
function c25() {
  return (made & 1 ? new C25() : C25.call({})).text;
}
class C26 {
  constructor() {
    this.text = c25();
  }
}
function c26() {
  return new C26().text;
}
class C27Base {
  constructor() {
    this.text = c26();
  }
}
class C27 extends C27Base {}
function c27() {
  return new C27().text;
}
class C28 {
  constructor() {
    this.text = c27();
  }
}
function c28() {
  return new C28().text;
}
function C29() {
  return { text: c28() };
}
function c29() {
  return new C29().text;
}
class C30 {
  constructor() {
    this.text = c29();
  }
}
function c30() {
  return new C30().text;
}
function c31Holder() {
  return { text: c30() };
}
function C31() {
  return c31Holder();
}
function c31() {
  return new C31().text;
}
function c32Holder() {
  return { text: c31() };
}
function C32() {
  this.level = 32;
  return c32Holder();
}
function c32() {
  return (made & 1 ? new C32() : C32.call({})).text;
}
class C33 {
  constructor() {
    this.text = c32();
  }
}
function c33() {
  return new C33().text;
}
class C34Base {
  constructor() {
    this.text = c33();
  }
}
class C34 extends C34Base {}
function c34() {
  return new C34().text;
}
class C35 {
  constructor() {
    this.text = c34();
  }
}
function c35() {
  return new C35().text;
}
function C36() {
  return { text: c35() };
}
function c36() {
  return new C36().text;
}
class C37 {
  constructor() {
    this.text = c36();
  }
}
function c37() {
  return new C37().text;
}
function c38Holder() {
  return { text: c37() };
}
function C38() {
  return c38Holder();
}
function c38() {
  return new C38().text;
}
function c39Holder() {
  return { text: c38() };
}
function C39() {
  this.level = 39;
  return c39Holder();
}
function c39() {
  return (made & 1 ? new C39() : C39.call({})).text;
}
class C40 {
  constructor() {
    this.text = c39();
  }
}
function c40() {
  return new C40().text;
}
class C41Base {
  constructor() {
    this.text = c40();
  }
}
class C41 extends C41Base {}
function c41() {
  return new C41().text;
}
class C42 {
  constructor() {
    this.text = c41();
  }
}
function c42() {
  return new C42().text;
}
function C43() {
  return { text: c42() };
}
function c43() {
  return new C43().text;
}
class C44 {
  constructor() {
    this.text = c43();
  }
}
function c44() {
  return new C44().text;
}
function c45Holder() {
  return { text: c44() };
}
function C45() {
  return c45Holder();
}
function c45() {
  return new C45().text;
}
function c46Holder() {
  return { text: c45() };
}
function C46() {
  this.level = 46;
  return c46Holder();
}
function c46() {
  return (made & 1 ? new C46() : C46.call({})).text;
}
class C47 {
  constructor() {
    this.text = c46();
  }
}
function c47() {
  return new C47().text;
}
class C48Base {
  constructor() {
    this.text = c47();
  }
}
class C48 extends C48Base {}
function c48() {
  return new C48().text;
}
class C49 {
  constructor() {
    this.text = c48();
  }
}
function c49() {
  return new C49().text;
}
function C50() {
  return { text: c49() };
}
function c50() {
  return new C50().text;
}
class C51 {
  constructor() {
    this.text = c50();
  }
}
function c51() {
  return new C51().text;
}
function c52Holder() {
  return { text: c51() };
}
function C52() {
  return c52Holder();
}
function c52() {
  return new C52().text;
}
function c53Holder() {
  return { text: c52() };
}
function C53() {
  this.level = 53;
  return c53Holder();
}
function c53() {
  return (made & 1 ? new C53() : C53.call({})).text;
}
class C54 {
  constructor() {
    this.text = c53();
  }
}
function c54() {
  return new C54().text;
}
class C55Base {
  constructor() {
    this.text = c54();
  }
}
class C55 extends C55Base {}
function c55() {
  return new C55().text;
}
class C56 {
  constructor() {
    this.text = c55();
  }
}
function c56() {
  return new C56().text;
}
function C57() {
  return { text: c56() };
}
function c57() {
  return new C57().text;
}
class C58 {
  constructor() {
    this.text = c57();
  }
}
function c58() {
  return new C58().text;
}
function c59Holder() {
  return { text: c58() };
}
function C59() {
  return c59Holder();
}
function c59() {
  return new C59().text;
}
function c60Holder() {
  return { text: c59() };
}
function C60() {
  this.level = 60;
  return c60Holder();
}
function c60() {
  return (made & 1 ? new C60() : C60.call({})).text;
}
class C61 {
  constructor() {
    this.text = c60();
  }
}
function c61() {
  return new C61().text;
}
class C62Base {
  constructor() {
    this.text = c61();
  }
}
class C62 extends C62Base {}
function c62() {
  return new C62().text;
}
class C63 {
  constructor() {
    this.text = c62();
  }
}
function c63() {
  return new C63().text;
}
function C64() {
  return { text: c63() };
}
function c64() {
  return new C64().text;
}
class C65 {
  constructor() {
    this.text = c64();
  }
}
function c65() {
  return new C65().text;
}
function c66Holder() {
  return { text: c65() };
}
function C66() {
  return c66Holder();
}
function c66() {
  return new C66().text;
}
function c67Holder() {
  return { text: c66() };
}
function C67() {
  this.level = 67;
  return c67Holder();
}
function c67() {
  return (made & 1 ? new C67() : C67.call({})).text;
}
class C68 {
  constructor() {
    this.text = c67();
  }
}
function c68() {
  return new C68().text;
}
class C69Base {
  constructor() {
    this.text = c68();
  }
}
class C69 extends C69Base {}
function c69() {
  return new C69().text;
}
class C70 {
  constructor() {
    this.text = c69();
  }
}
function c70() {
  return new C70().text;
}
function C71() {
  return { text: c70() };
}
function c71() {
  return new C71().text;
}
class C72 {
  constructor() {
    this.text = c71();
  }
}
function c72() {
  return new C72().text;
}
function c73Holder() {
  return { text: c72() };
}
function C73() {
  return c73Holder();
}
function c73() {
  return new C73().text;
}
function c74Holder() {
  return { text: c73() };
}
function C74() {
  this.level = 74;
  return c74Holder();
}
function c74() {
  return (made & 1 ? new C74() : C74.call({})).text;
}
class C75 {
  constructor() {
    this.text = c74();
  }
}
function c75() {
  return new C75().text;
}
class C76Base {
  constructor() {
    this.text = c75();
  }
}
class C76 extends C76Base {}
function c76() {
  return new C76().text;
}
class C77 {
  constructor() {
    this.text = c76();
  }
}
function c77() {
  return new C77().text;
}
function C78() {
  return { text: c77() };
}
function c78() {
  return new C78().text;
}
class C79 {
  constructor() {
    this.text = c78();
  }
}
function c79() {
  return new C79().text;
}
function c80Holder() {
  return { text: c79() };
}
function C80() {
  return c80Holder();
}
function c80() {
  return new C80().text;
}
function c81Holder() {
  return { text: c80() };
}
function C81() {
  this.level = 81;
  return c81Holder();
}
function c81() {
  return (made & 1 ? new C81() : C81.call({})).text;
}
class C82 {
  constructor() {
    this.text = c81();
  }
}
function c82() {
  return new C82().text;
}
class C83Base {
  constructor() {
    this.text = c82();
  }
}
class C83 extends C83Base {}
function c83() {
  return new C83().text;
}
class C84 {
  constructor() {
    this.text = c83();
  }
}
function c84() {
  return new C84().text;
}
function C85() {
  return { text: c84() };
}
function c85() {
  return new C85().text;
}
class C86 {
  constructor() {
    this.text = c85();
  }
}
function c86() {
  return new C86().text;
}
function c87Holder() {
  return { text: c86() };
}
function C87() {
  return c87Holder();
}
function c87() {
  return new C87().text;
}
function c88Holder() {
  return { text: c87() };
}
function C88() {
  this.level = 88;
  return c88Holder();
}
function c88() {
  return (made & 1 ? new C88() : C88.call({})).text;
}
class C89 {
  constructor() {
    this.text = c88();
  }
}
function c89() {
  return new C89().text;
}
class C90Base {
  constructor() {
    this.text = c89();
  }
}
class C90 extends C90Base {}
function c90() {
  return new C90().text;
}
class C91 {
  constructor() {
    this.text = c90();
  }
}
function c91() {
  return new C91().text;
}
function C92() {
  return { text: c91() };
}
function c92() {
  return new C92().text;
}
class C93 {
  constructor() {
    this.text = c92();
  }
}
function c93() {
  return new C93().text;
}
function c94Holder() {
  return { text: c93() };
}
function C94() {
  return c94Holder();
}
function c94() {
  return new C94().text;
}
function c95Holder() {
  return { text: c94() };
}
function C95() {
  this.level = 95;
  return c95Holder();
}
function c95() {
  return (made & 1 ? new C95() : C95.call({})).text;
}
class C96 {
  constructor() {
    this.text = c95();
  }
}
function c96() {
  return new C96().text;
}
class C97Base {
  constructor() {
    this.text = c96();
  }
}
class C97 extends C97Base {}
function c97() {
  return new C97().text;
}
class C98 {
  constructor() {
    this.text = c97();
  }
}
function c98() {
  return new C98().text;
}
function C99() {
  return { text: c98() };
}
function c99() {
  return new C99().text;
}
class C100 {
  constructor() {
    this.text = c99();
  }
}
function c100() {
  return new C100().text;
}
function d0() {
  made++;
  return frames(new Error("d"));
}
class D1 {
  constructor() {
    this.text = d0();
  }
}
function d1() {
  return new D1().text;
}
function d2Holder() {
  return { text: d1() };
}
function D2() {
  return d2Holder();
}
function d2() {
  return new D2().text;
}
function d3Holder() {
  return { text: d2() };
}
function D3() {
  this.level = 3;
  return d3Holder();
}
function d3() {
  return (made & 1 ? new D3() : D3.call({})).text;
}
class D4 {
  constructor() {
    this.text = d3();
  }
}
function d4() {
  return new D4().text;
}
class D5Base {
  constructor() {
    this.text = d4();
  }
}
class D5 extends D5Base {}
function d5() {
  return new D5().text;
}
class D6 {
  constructor() {
    this.text = d5();
  }
}
function d6() {
  return new D6().text;
}
function D7() {
  return { text: d6() };
}
function d7() {
  return new D7().text;
}
class D8 {
  constructor() {
    this.text = d7();
  }
}
function d8() {
  return new D8().text;
}
function d9Holder() {
  return { text: d8() };
}
function D9() {
  return d9Holder();
}
function d9() {
  return new D9().text;
}
function d10Holder() {
  return { text: d9() };
}
function D10() {
  this.level = 10;
  return d10Holder();
}
function d10() {
  return (made & 1 ? new D10() : D10.call({})).text;
}
class D11 {
  constructor() {
    this.text = d10();
  }
}
function d11() {
  return new D11().text;
}
class D12Base {
  constructor() {
    this.text = d11();
  }
}
class D12 extends D12Base {}
function d12() {
  return new D12().text;
}
class D13 {
  constructor() {
    this.text = d12();
  }
}
function d13() {
  return new D13().text;
}
function D14() {
  return { text: d13() };
}
function d14() {
  return new D14().text;
}
class D15 {
  constructor() {
    this.text = d14();
  }
}
function d15() {
  return new D15().text;
}
function d16Holder() {
  return { text: d15() };
}
function D16() {
  return d16Holder();
}
function d16() {
  return new D16().text;
}
function d17Holder() {
  return { text: d16() };
}
function D17() {
  this.level = 17;
  return d17Holder();
}
function d17() {
  return (made & 1 ? new D17() : D17.call({})).text;
}
class D18 {
  constructor() {
    this.text = d17();
  }
}
function d18() {
  return new D18().text;
}
class D19Base {
  constructor() {
    this.text = d18();
  }
}
class D19 extends D19Base {}
function d19() {
  return new D19().text;
}
class D20 {
  constructor() {
    this.text = d19();
  }
}
function d20() {
  return new D20().text;
}
function D21() {
  return { text: d20() };
}
function d21() {
  return new D21().text;
}
class D22 {
  constructor() {
    this.text = d21();
  }
}
function d22() {
  return new D22().text;
}
function d23Holder() {
  return { text: d22() };
}
function D23() {
  return d23Holder();
}
function d23() {
  return new D23().text;
}
function d24Holder() {
  return { text: d23() };
}
function D24() {
  this.level = 24;
  return d24Holder();
}
function d24() {
  return (made & 1 ? new D24() : D24.call({})).text;
}
class D25 {
  constructor() {
    this.text = d24();
  }
}
function d25() {
  return new D25().text;
}
class D26Base {
  constructor() {
    this.text = d25();
  }
}
class D26 extends D26Base {}
function d26() {
  return new D26().text;
}
class D27 {
  constructor() {
    this.text = d26();
  }
}
function d27() {
  return new D27().text;
}
function D28() {
  return { text: d27() };
}
function d28() {
  return new D28().text;
}
class D29 {
  constructor() {
    this.text = d28();
  }
}
function d29() {
  return new D29().text;
}
function d30Holder() {
  return { text: d29() };
}
function D30() {
  return d30Holder();
}
function d30() {
  return new D30().text;
}
function d31Holder() {
  return { text: d30() };
}
function D31() {
  this.level = 31;
  return d31Holder();
}
function d31() {
  return (made & 1 ? new D31() : D31.call({})).text;
}
class D32 {
  constructor() {
    this.text = d31();
  }
}
function d32() {
  return new D32().text;
}
class D33Base {
  constructor() {
    this.text = d32();
  }
}
class D33 extends D33Base {}
function d33() {
  return new D33().text;
}
class D34 {
  constructor() {
    this.text = d33();
  }
}
function d34() {
  return new D34().text;
}
function D35() {
  return { text: d34() };
}
function d35() {
  return new D35().text;
}
class D36 {
  constructor() {
    this.text = d35();
  }
}
function d36() {
  return new D36().text;
}
function d37Holder() {
  return { text: d36() };
}
function D37() {
  return d37Holder();
}
function d37() {
  return new D37().text;
}
function d38Holder() {
  return { text: d37() };
}
function D38() {
  this.level = 38;
  return d38Holder();
}
function d38() {
  return (made & 1 ? new D38() : D38.call({})).text;
}
class D39 {
  constructor() {
    this.text = d38();
  }
}
function d39() {
  return new D39().text;
}
class D40Base {
  constructor() {
    this.text = d39();
  }
}
class D40 extends D40Base {}
function d40() {
  return new D40().text;
}
class D41 {
  constructor() {
    this.text = d40();
  }
}
function d41() {
  return new D41().text;
}
function D42() {
  return { text: d41() };
}
function d42() {
  return new D42().text;
}
class D43 {
  constructor() {
    this.text = d42();
  }
}
function d43() {
  return new D43().text;
}
function d44Holder() {
  return { text: d43() };
}
function D44() {
  return d44Holder();
}
function d44() {
  return new D44().text;
}
function d45Holder() {
  return { text: d44() };
}
function D45() {
  this.level = 45;
  return d45Holder();
}
function d45() {
  return (made & 1 ? new D45() : D45.call({})).text;
}
class D46 {
  constructor() {
    this.text = d45();
  }
}
function d46() {
  return new D46().text;
}
class D47Base {
  constructor() {
    this.text = d46();
  }
}
class D47 extends D47Base {}
function d47() {
  return new D47().text;
}
class D48 {
  constructor() {
    this.text = d47();
  }
}
function d48() {
  return new D48().text;
}
function D49() {
  return { text: d48() };
}
function d49() {
  return new D49().text;
}
class D50 {
  constructor() {
    this.text = d49();
  }
}
function d50() {
  return new D50().text;
}
function d51Holder() {
  return { text: d50() };
}
function D51() {
  return d51Holder();
}
function d51() {
  return new D51().text;
}
function d52Holder() {
  return { text: d51() };
}
function D52() {
  this.level = 52;
  return d52Holder();
}
function d52() {
  return (made & 1 ? new D52() : D52.call({})).text;
}
class D53 {
  constructor() {
    this.text = d52();
  }
}
function d53() {
  return new D53().text;
}
class D54Base {
  constructor() {
    this.text = d53();
  }
}
class D54 extends D54Base {}
function d54() {
  return new D54().text;
}
class D55 {
  constructor() {
    this.text = d54();
  }
}
function d55() {
  return new D55().text;
}
function D56() {
  return { text: d55() };
}
function d56() {
  return new D56().text;
}
class D57 {
  constructor() {
    this.text = d56();
  }
}
function d57() {
  return new D57().text;
}
function d58Holder() {
  return { text: d57() };
}
function D58() {
  return d58Holder();
}
function d58() {
  return new D58().text;
}
function d59Holder() {
  return { text: d58() };
}
function D59() {
  this.level = 59;
  return d59Holder();
}
function d59() {
  return (made & 1 ? new D59() : D59.call({})).text;
}
class D60 {
  constructor() {
    this.text = d59();
  }
}
function d60() {
  return new D60().text;
}
class D61Base {
  constructor() {
    this.text = d60();
  }
}
class D61 extends D61Base {}
function d61() {
  return new D61().text;
}
class D62 {
  constructor() {
    this.text = d61();
  }
}
function d62() {
  return new D62().text;
}
function D63() {
  return { text: d62() };
}
function d63() {
  return new D63().text;
}
class D64 {
  constructor() {
    this.text = d63();
  }
}
function d64() {
  return new D64().text;
}
function d65Holder() {
  return { text: d64() };
}
function D65() {
  return d65Holder();
}
function d65() {
  return new D65().text;
}
function d66Holder() {
  return { text: d65() };
}
function D66() {
  this.level = 66;
  return d66Holder();
}
function d66() {
  return (made & 1 ? new D66() : D66.call({})).text;
}
class D67 {
  constructor() {
    this.text = d66();
  }
}
function d67() {
  return new D67().text;
}
class D68Base {
  constructor() {
    this.text = d67();
  }
}
class D68 extends D68Base {}
function d68() {
  return new D68().text;
}
class D69 {
  constructor() {
    this.text = d68();
  }
}
function d69() {
  return new D69().text;
}
function D70() {
  return { text: d69() };
}
function d70() {
  return new D70().text;
}
class D71 {
  constructor() {
    this.text = d70();
  }
}
function d71() {
  return new D71().text;
}
function d72Holder() {
  return { text: d71() };
}
function D72() {
  return d72Holder();
}
function d72() {
  return new D72().text;
}
function d73Holder() {
  return { text: d72() };
}
function D73() {
  this.level = 73;
  return d73Holder();
}
function d73() {
  return (made & 1 ? new D73() : D73.call({})).text;
}
class D74 {
  constructor() {
    this.text = d73();
  }
}
function d74() {
  return new D74().text;
}
class D75Base {
  constructor() {
    this.text = d74();
  }
}
class D75 extends D75Base {}
function d75() {
  return new D75().text;
}
class D76 {
  constructor() {
    this.text = d75();
  }
}
function d76() {
  return new D76().text;
}
function D77() {
  return { text: d76() };
}
function d77() {
  return new D77().text;
}
class D78 {
  constructor() {
    this.text = d77();
  }
}
function d78() {
  return new D78().text;
}
function d79Holder() {
  return { text: d78() };
}
function D79() {
  return d79Holder();
}
function d79() {
  return new D79().text;
}
function d80Holder() {
  return { text: d79() };
}
function D80() {
  this.level = 80;
  return d80Holder();
}
function d80() {
  return (made & 1 ? new D80() : D80.call({})).text;
}
class D81 {
  constructor() {
    this.text = d80();
  }
}
function d81() {
  return new D81().text;
}
class D82Base {
  constructor() {
    this.text = d81();
  }
}
class D82 extends D82Base {}
function d82() {
  return new D82().text;
}
class D83 {
  constructor() {
    this.text = d82();
  }
}
function d83() {
  return new D83().text;
}
function D84() {
  return { text: d83() };
}
function d84() {
  return new D84().text;
}
class D85 {
  constructor() {
    this.text = d84();
  }
}
function d85() {
  return new D85().text;
}
function d86Holder() {
  return { text: d85() };
}
function D86() {
  return d86Holder();
}
function d86() {
  return new D86().text;
}
function d87Holder() {
  return { text: d86() };
}
function D87() {
  this.level = 87;
  return d87Holder();
}
function d87() {
  return (made & 1 ? new D87() : D87.call({})).text;
}
class D88 {
  constructor() {
    this.text = d87();
  }
}
function d88() {
  return new D88().text;
}
class D89Base {
  constructor() {
    this.text = d88();
  }
}
class D89 extends D89Base {}
function d89() {
  return new D89().text;
}
class D90 {
  constructor() {
    this.text = d89();
  }
}
function d90() {
  return new D90().text;
}
function D91() {
  return { text: d90() };
}
function d91() {
  return new D91().text;
}
class D92 {
  constructor() {
    this.text = d91();
  }
}
function d92() {
  return new D92().text;
}
function d93Holder() {
  return { text: d92() };
}
function D93() {
  return d93Holder();
}
function d93() {
  return new D93().text;
}
function d94Holder() {
  return { text: d93() };
}
function D94() {
  this.level = 94;
  return d94Holder();
}
function d94() {
  return (made & 1 ? new D94() : D94.call({})).text;
}
class D95 {
  constructor() {
    this.text = d94();
  }
}
function d95() {
  return new D95().text;
}
class D96Base {
  constructor() {
    this.text = d95();
  }
}
class D96 extends D96Base {}
function d96() {
  return new D96().text;
}
class D97 {
  constructor() {
    this.text = d96();
  }
}
function d97() {
  return new D97().text;
}
function D98() {
  return { text: d97() };
}
function d98() {
  return new D98().text;
}
class D99 {
  constructor() {
    this.text = d98();
  }
}
function d99() {
  return new D99().text;
}
function d100Holder() {
  return { text: d99() };
}
function D100() {
  return d100Holder();
}
function d100() {
  return new D100().text;
}
function e0() {
  made++;
  return frames(new Error("e"));
}
function e1Holder() {
  return { text: e0() };
}
function E1() {
  return e1Holder();
}
function e1() {
  return new E1().text;
}
function e2Holder() {
  return { text: e1() };
}
function E2() {
  this.level = 2;
  return e2Holder();
}
function e2() {
  return (made & 1 ? new E2() : E2.call({})).text;
}
class E3 {
  constructor() {
    this.text = e2();
  }
}
function e3() {
  return new E3().text;
}
class E4Base {
  constructor() {
    this.text = e3();
  }
}
class E4 extends E4Base {}
function e4() {
  return new E4().text;
}
class E5 {
  constructor() {
    this.text = e4();
  }
}
function e5() {
  return new E5().text;
}
function E6() {
  return { text: e5() };
}
function e6() {
  return new E6().text;
}
class E7 {
  constructor() {
    this.text = e6();
  }
}
function e7() {
  return new E7().text;
}
function e8Holder() {
  return { text: e7() };
}
function E8() {
  return e8Holder();
}
function e8() {
  return new E8().text;
}
function e9Holder() {
  return { text: e8() };
}
function E9() {
  this.level = 9;
  return e9Holder();
}
function e9() {
  return (made & 1 ? new E9() : E9.call({})).text;
}
class E10 {
  constructor() {
    this.text = e9();
  }
}
function e10() {
  return new E10().text;
}
class E11Base {
  constructor() {
    this.text = e10();
  }
}
class E11 extends E11Base {}
function e11() {
  return new E11().text;
}
class E12 {
  constructor() {
    this.text = e11();
  }
}
function e12() {
  return new E12().text;
}
function E13() {
  return { text: e12() };
}
function e13() {
  return new E13().text;
}
class E14 {
  constructor() {
    this.text = e13();
  }
}
function e14() {
  return new E14().text;
}
function e15Holder() {
  return { text: e14() };
}
function E15() {
  return e15Holder();
}
function e15() {
  return new E15().text;
}
function e16Holder() {
  return { text: e15() };
}
function E16() {
  this.level = 16;
  return e16Holder();
}
function e16() {
  return (made & 1 ? new E16() : E16.call({})).text;
}
class E17 {
  constructor() {
    this.text = e16();
  }
}
function e17() {
  return new E17().text;
}
class E18Base {
  constructor() {
    this.text = e17();
  }
}
class E18 extends E18Base {}
function e18() {
  return new E18().text;
}
class E19 {
  constructor() {
    this.text = e18();
  }
}
function e19() {
  return new E19().text;
}
function E20() {
  return { text: e19() };
}
function e20() {
  return new E20().text;
}
class E21 {
  constructor() {
    this.text = e20();
  }
}
function e21() {
  return new E21().text;
}
function e22Holder() {
  return { text: e21() };
}
function E22() {
  return e22Holder();
}
function e22() {
  return new E22().text;
}
function e23Holder() {
  return { text: e22() };
}
function E23() {
  this.level = 23;
  return e23Holder();
}
function e23() {
  return (made & 1 ? new E23() : E23.call({})).text;
}
class E24 {
  constructor() {
    this.text = e23();
  }
}
function e24() {
  return new E24().text;
}
class E25Base {
  constructor() {
    this.text = e24();
  }
}
class E25 extends E25Base {}
function e25() {
  return new E25().text;
}
class E26 {
  constructor() {
    this.text = e25();
  }
}
function e26() {
  return new E26().text;
}
function E27() {
  return { text: e26() };
}
function e27() {
  return new E27().text;
}
class E28 {
  constructor() {
    this.text = e27();
  }
}
function e28() {
  return new E28().text;
}
function e29Holder() {
  return { text: e28() };
}
function E29() {
  return e29Holder();
}
function e29() {
  return new E29().text;
}
function e30Holder() {
  return { text: e29() };
}
function E30() {
  this.level = 30;
  return e30Holder();
}
function e30() {
  return (made & 1 ? new E30() : E30.call({})).text;
}
class E31 {
  constructor() {
    this.text = e30();
  }
}
function e31() {
  return new E31().text;
}
class E32Base {
  constructor() {
    this.text = e31();
  }
}
class E32 extends E32Base {}
function e32() {
  return new E32().text;
}
class E33 {
  constructor() {
    this.text = e32();
  }
}
function e33() {
  return new E33().text;
}
function E34() {
  return { text: e33() };
}
function e34() {
  return new E34().text;
}
class E35 {
  constructor() {
    this.text = e34();
  }
}
function e35() {
  return new E35().text;
}
function e36Holder() {
  return { text: e35() };
}
function E36() {
  return e36Holder();
}
function e36() {
  return new E36().text;
}
function e37Holder() {
  return { text: e36() };
}
function E37() {
  this.level = 37;
  return e37Holder();
}
function e37() {
  return (made & 1 ? new E37() : E37.call({})).text;
}
class E38 {
  constructor() {
    this.text = e37();
  }
}
function e38() {
  return new E38().text;
}
class E39Base {
  constructor() {
    this.text = e38();
  }
}
class E39 extends E39Base {}
function e39() {
  return new E39().text;
}
class E40 {
  constructor() {
    this.text = e39();
  }
}
function e40() {
  return new E40().text;
}
function E41() {
  return { text: e40() };
}
function e41() {
  return new E41().text;
}
class E42 {
  constructor() {
    this.text = e41();
  }
}
function e42() {
  return new E42().text;
}
function e43Holder() {
  return { text: e42() };
}
function E43() {
  return e43Holder();
}
function e43() {
  return new E43().text;
}
function e44Holder() {
  return { text: e43() };
}
function E44() {
  this.level = 44;
  return e44Holder();
}
function e44() {
  return (made & 1 ? new E44() : E44.call({})).text;
}
class E45 {
  constructor() {
    this.text = e44();
  }
}
function e45() {
  return new E45().text;
}
class E46Base {
  constructor() {
    this.text = e45();
  }
}
class E46 extends E46Base {}
function e46() {
  return new E46().text;
}
class E47 {
  constructor() {
    this.text = e46();
  }
}
function e47() {
  return new E47().text;
}
function E48() {
  return { text: e47() };
}
function e48() {
  return new E48().text;
}
class E49 {
  constructor() {
    this.text = e48();
  }
}
function e49() {
  return new E49().text;
}
function e50Holder() {
  return { text: e49() };
}
function E50() {
  return e50Holder();
}
function e50() {
  return new E50().text;
}
function e51Holder() {
  return { text: e50() };
}
function E51() {
  this.level = 51;
  return e51Holder();
}
function e51() {
  return (made & 1 ? new E51() : E51.call({})).text;
}
class E52 {
  constructor() {
    this.text = e51();
  }
}
function e52() {
  return new E52().text;
}
class E53Base {
  constructor() {
    this.text = e52();
  }
}
class E53 extends E53Base {}
function e53() {
  return new E53().text;
}
class E54 {
  constructor() {
    this.text = e53();
  }
}
function e54() {
  return new E54().text;
}
function E55() {
  return { text: e54() };
}
function e55() {
  return new E55().text;
}
class E56 {
  constructor() {
    this.text = e55();
  }
}
function e56() {
  return new E56().text;
}
function e57Holder() {
  return { text: e56() };
}
function E57() {
  return e57Holder();
}
function e57() {
  return new E57().text;
}
function e58Holder() {
  return { text: e57() };
}
function E58() {
  this.level = 58;
  return e58Holder();
}
function e58() {
  return (made & 1 ? new E58() : E58.call({})).text;
}
class E59 {
  constructor() {
    this.text = e58();
  }
}
function e59() {
  return new E59().text;
}
class E60Base {
  constructor() {
    this.text = e59();
  }
}
class E60 extends E60Base {}
function e60() {
  return new E60().text;
}
class E61 {
  constructor() {
    this.text = e60();
  }
}
function e61() {
  return new E61().text;
}
function E62() {
  return { text: e61() };
}
function e62() {
  return new E62().text;
}
class E63 {
  constructor() {
    this.text = e62();
  }
}
function e63() {
  return new E63().text;
}
function e64Holder() {
  return { text: e63() };
}
function E64() {
  return e64Holder();
}
function e64() {
  return new E64().text;
}
function e65Holder() {
  return { text: e64() };
}
function E65() {
  this.level = 65;
  return e65Holder();
}
function e65() {
  return (made & 1 ? new E65() : E65.call({})).text;
}
class E66 {
  constructor() {
    this.text = e65();
  }
}
function e66() {
  return new E66().text;
}
class E67Base {
  constructor() {
    this.text = e66();
  }
}
class E67 extends E67Base {}
function e67() {
  return new E67().text;
}
class E68 {
  constructor() {
    this.text = e67();
  }
}
function e68() {
  return new E68().text;
}
function E69() {
  return { text: e68() };
}
function e69() {
  return new E69().text;
}
class E70 {
  constructor() {
    this.text = e69();
  }
}
function e70() {
  return new E70().text;
}
function e71Holder() {
  return { text: e70() };
}
function E71() {
  return e71Holder();
}
function e71() {
  return new E71().text;
}
function e72Holder() {
  return { text: e71() };
}
function E72() {
  this.level = 72;
  return e72Holder();
}
function e72() {
  return (made & 1 ? new E72() : E72.call({})).text;
}
class E73 {
  constructor() {
    this.text = e72();
  }
}
function e73() {
  return new E73().text;
}
class E74Base {
  constructor() {
    this.text = e73();
  }
}
class E74 extends E74Base {}
function e74() {
  return new E74().text;
}
class E75 {
  constructor() {
    this.text = e74();
  }
}
function e75() {
  return new E75().text;
}
function E76() {
  return { text: e75() };
}
function e76() {
  return new E76().text;
}
class E77 {
  constructor() {
    this.text = e76();
  }
}
function e77() {
  return new E77().text;
}
function e78Holder() {
  return { text: e77() };
}
function E78() {
  return e78Holder();
}
function e78() {
  return new E78().text;
}
function e79Holder() {
  return { text: e78() };
}
function E79() {
  this.level = 79;
  return e79Holder();
}
function e79() {
  return (made & 1 ? new E79() : E79.call({})).text;
}
class E80 {
  constructor() {
    this.text = e79();
  }
}
function e80() {
  return new E80().text;
}
class E81Base {
  constructor() {
    this.text = e80();
  }
}
class E81 extends E81Base {}
function e81() {
  return new E81().text;
}
class E82 {
  constructor() {
    this.text = e81();
  }
}
function e82() {
  return new E82().text;
}
function E83() {
  return { text: e82() };
}
function e83() {
  return new E83().text;
}
class E84 {
  constructor() {
    this.text = e83();
  }
}
function e84() {
  return new E84().text;
}
function e85Holder() {
  return { text: e84() };
}
function E85() {
  return e85Holder();
}
function e85() {
  return new E85().text;
}
function e86Holder() {
  return { text: e85() };
}
function E86() {
  this.level = 86;
  return e86Holder();
}
function e86() {
  return (made & 1 ? new E86() : E86.call({})).text;
}
class E87 {
  constructor() {
    this.text = e86();
  }
}
function e87() {
  return new E87().text;
}
class E88Base {
  constructor() {
    this.text = e87();
  }
}
class E88 extends E88Base {}
function e88() {
  return new E88().text;
}
class E89 {
  constructor() {
    this.text = e88();
  }
}
function e89() {
  return new E89().text;
}
function E90() {
  return { text: e89() };
}
function e90() {
  return new E90().text;
}
class E91 {
  constructor() {
    this.text = e90();
  }
}
function e91() {
  return new E91().text;
}
function e92Holder() {
  return { text: e91() };
}
function E92() {
  return e92Holder();
}
function e92() {
  return new E92().text;
}
function e93Holder() {
  return { text: e92() };
}
function E93() {
  this.level = 93;
  return e93Holder();
}
function e93() {
  return (made & 1 ? new E93() : E93.call({})).text;
}
class E94 {
  constructor() {
    this.text = e93();
  }
}
function e94() {
  return new E94().text;
}
class E95Base {
  constructor() {
    this.text = e94();
  }
}
class E95 extends E95Base {}
function e95() {
  return new E95().text;
}
class E96 {
  constructor() {
    this.text = e95();
  }
}
function e96() {
  return new E96().text;
}
function E97() {
  return { text: e96() };
}
function e97() {
  return new E97().text;
}
class E98 {
  constructor() {
    this.text = e97();
  }
}
function e98() {
  return new E98().text;
}
function e99Holder() {
  return { text: e98() };
}
function E99() {
  return e99Holder();
}
function e99() {
  return new E99().text;
}
function e100Holder() {
  return { text: e99() };
}
function E100() {
  this.level = 100;
  return e100Holder();
}
function e100() {
  return (made & 1 ? new E100() : E100.call({})).text;
}
function f0() {
  made++;
  return frames(new Error("f"));
}
function f1Holder() {
  return { text: f0() };
}
function F1() {
  this.level = 1;
  return f1Holder();
}
function f1() {
  return (made & 1 ? new F1() : F1.call({})).text;
}
class F2 {
  constructor() {
    this.text = f1();
  }
}
function f2() {
  return new F2().text;
}
class F3Base {
  constructor() {
    this.text = f2();
  }
}
class F3 extends F3Base {}
function f3() {
  return new F3().text;
}
class F4 {
  constructor() {
    this.text = f3();
  }
}
function f4() {
  return new F4().text;
}
function F5() {
  return { text: f4() };
}
function f5() {
  return new F5().text;
}
class F6 {
  constructor() {
    this.text = f5();
  }
}
function f6() {
  return new F6().text;
}
function f7Holder() {
  return { text: f6() };
}
function F7() {
  return f7Holder();
}
function f7() {
  return new F7().text;
}
function f8Holder() {
  return { text: f7() };
}
function F8() {
  this.level = 8;
  return f8Holder();
}
function f8() {
  return (made & 1 ? new F8() : F8.call({})).text;
}
class F9 {
  constructor() {
    this.text = f8();
  }
}
function f9() {
  return new F9().text;
}
class F10Base {
  constructor() {
    this.text = f9();
  }
}
class F10 extends F10Base {}
function f10() {
  return new F10().text;
}
class F11 {
  constructor() {
    this.text = f10();
  }
}
function f11() {
  return new F11().text;
}
function F12() {
  return { text: f11() };
}
function f12() {
  return new F12().text;
}
class F13 {
  constructor() {
    this.text = f12();
  }
}
function f13() {
  return new F13().text;
}
function f14Holder() {
  return { text: f13() };
}
function F14() {
  return f14Holder();
}
function f14() {
  return new F14().text;
}
function f15Holder() {
  return { text: f14() };
}
function F15() {
  this.level = 15;
  return f15Holder();
}
function f15() {
  return (made & 1 ? new F15() : F15.call({})).text;
}
class F16 {
  constructor() {
    this.text = f15();
  }
}
function f16() {
  return new F16().text;
}
class F17Base {
  constructor() {
    this.text = f16();
  }
}
class F17 extends F17Base {}
function f17() {
  return new F17().text;
}
class F18 {
  constructor() {
    this.text = f17();
  }
}
function f18() {
  return new F18().text;
}
function F19() {
  return { text: f18() };
}
function f19() {
  return new F19().text;
}
class F20 {
  constructor() {
    this.text = f19();
  }
}
function f20() {
  return new F20().text;
}
function f21Holder() {
  return { text: f20() };
}
function F21() {
  return f21Holder();
}
function f21() {
  return new F21().text;
}
function f22Holder() {
  return { text: f21() };
}
function F22() {
  this.level = 22;
  return f22Holder();
}
function f22() {
  return (made & 1 ? new F22() : F22.call({})).text;
}
class F23 {
  constructor() {
    this.text = f22();
  }
}
function f23() {
  return new F23().text;
}
class F24Base {
  constructor() {
    this.text = f23();
  }
}
class F24 extends F24Base {}
function f24() {
  return new F24().text;
}
class F25 {
  constructor() {
    this.text = f24();
  }
}
function f25() {
  return new F25().text;
}
function F26() {
  return { text: f25() };
}
function f26() {
  return new F26().text;
}
class F27 {
  constructor() {
    this.text = f26();
  }
}
function f27() {
  return new F27().text;
}
function f28Holder() {
  return { text: f27() };
}
function F28() {
  return f28Holder();
}
function f28() {
  return new F28().text;
}
function f29Holder() {
  return { text: f28() };
}
function F29() {
  this.level = 29;
  return f29Holder();
}
function f29() {
  return (made & 1 ? new F29() : F29.call({})).text;
}
class F30 {
  constructor() {
    this.text = f29();
  }
}
function f30() {
  return new F30().text;
}
class F31Base {
  constructor() {
    this.text = f30();
  }
}
class F31 extends F31Base {}
function f31() {
  return new F31().text;
}
class F32 {
  constructor() {
    this.text = f31();
  }
}
function f32() {
  return new F32().text;
}
function F33() {
  return { text: f32() };
}
function f33() {
  return new F33().text;
}
class F34 {
  constructor() {
    this.text = f33();
  }
}
function f34() {
  return new F34().text;
}
function f35Holder() {
  return { text: f34() };
}
function F35() {
  return f35Holder();
}
function f35() {
  return new F35().text;
}
function f36Holder() {
  return { text: f35() };
}
function F36() {
  this.level = 36;
  return f36Holder();
}
function f36() {
  return (made & 1 ? new F36() : F36.call({})).text;
}
class F37 {
  constructor() {
    this.text = f36();
  }
}
function f37() {
  return new F37().text;
}
class F38Base {
  constructor() {
    this.text = f37();
  }
}
class F38 extends F38Base {}
function f38() {
  return new F38().text;
}
class F39 {
  constructor() {
    this.text = f38();
  }
}
function f39() {
  return new F39().text;
}
function F40() {
  return { text: f39() };
}
function f40() {
  return new F40().text;
}
class F41 {
  constructor() {
    this.text = f40();
  }
}
function f41() {
  return new F41().text;
}
function f42Holder() {
  return { text: f41() };
}
function F42() {
  return f42Holder();
}
function f42() {
  return new F42().text;
}
function f43Holder() {
  return { text: f42() };
}
function F43() {
  this.level = 43;
  return f43Holder();
}
function f43() {
  return (made & 1 ? new F43() : F43.call({})).text;
}
class F44 {
  constructor() {
    this.text = f43();
  }
}
function f44() {
  return new F44().text;
}
class F45Base {
  constructor() {
    this.text = f44();
  }
}
class F45 extends F45Base {}
function f45() {
  return new F45().text;
}
class F46 {
  constructor() {
    this.text = f45();
  }
}
function f46() {
  return new F46().text;
}
function F47() {
  return { text: f46() };
}
function f47() {
  return new F47().text;
}
class F48 {
  constructor() {
    this.text = f47();
  }
}
function f48() {
  return new F48().text;
}
function f49Holder() {
  return { text: f48() };
}
function F49() {
  return f49Holder();
}
function f49() {
  return new F49().text;
}
function f50Holder() {
  return { text: f49() };
}
function F50() {
  this.level = 50;
  return f50Holder();
}
function f50() {
  return (made & 1 ? new F50() : F50.call({})).text;
}
class F51 {
  constructor() {
    this.text = f50();
  }
}
function f51() {
  return new F51().text;
}
class F52Base {
  constructor() {
    this.text = f51();
  }
}
class F52 extends F52Base {}
function f52() {
  return new F52().text;
}
class F53 {
  constructor() {
    this.text = f52();
  }
}
function f53() {
  return new F53().text;
}
function F54() {
  return { text: f53() };
}
function f54() {
  return new F54().text;
}
class F55 {
  constructor() {
    this.text = f54();
  }
}
function f55() {
  return new F55().text;
}
function f56Holder() {
  return { text: f55() };
}
function F56() {
  return f56Holder();
}
function f56() {
  return new F56().text;
}
function f57Holder() {
  return { text: f56() };
}
function F57() {
  this.level = 57;
  return f57Holder();
}
function f57() {
  return (made & 1 ? new F57() : F57.call({})).text;
}
class F58 {
  constructor() {
    this.text = f57();
  }
}
function f58() {
  return new F58().text;
}
class F59Base {
  constructor() {
    this.text = f58();
  }
}
class F59 extends F59Base {}
function f59() {
  return new F59().text;
}
class F60 {
  constructor() {
    this.text = f59();
  }
}
function f60() {
  return new F60().text;
}
function F61() {
  return { text: f60() };
}
function f61() {
  return new F61().text;
}
class F62 {
  constructor() {
    this.text = f61();
  }
}
function f62() {
  return new F62().text;
}
function f63Holder() {
  return { text: f62() };
}
function F63() {
  return f63Holder();
}
function f63() {
  return new F63().text;
}
function f64Holder() {
  return { text: f63() };
}
function F64() {
  this.level = 64;
  return f64Holder();
}
function f64() {
  return (made & 1 ? new F64() : F64.call({})).text;
}
class F65 {
  constructor() {
    this.text = f64();
  }
}
function f65() {
  return new F65().text;
}
class F66Base {
  constructor() {
    this.text = f65();
  }
}
class F66 extends F66Base {}
function f66() {
  return new F66().text;
}
class F67 {
  constructor() {
    this.text = f66();
  }
}
function f67() {
  return new F67().text;
}
function F68() {
  return { text: f67() };
}
function f68() {
  return new F68().text;
}
class F69 {
  constructor() {
    this.text = f68();
  }
}
function f69() {
  return new F69().text;
}
function f70Holder() {
  return { text: f69() };
}
function F70() {
  return f70Holder();
}
function f70() {
  return new F70().text;
}
function f71Holder() {
  return { text: f70() };
}
function F71() {
  this.level = 71;
  return f71Holder();
}
function f71() {
  return (made & 1 ? new F71() : F71.call({})).text;
}
class F72 {
  constructor() {
    this.text = f71();
  }
}
function f72() {
  return new F72().text;
}
class F73Base {
  constructor() {
    this.text = f72();
  }
}
class F73 extends F73Base {}
function f73() {
  return new F73().text;
}
class F74 {
  constructor() {
    this.text = f73();
  }
}
function f74() {
  return new F74().text;
}
function F75() {
  return { text: f74() };
}
function f75() {
  return new F75().text;
}
class F76 {
  constructor() {
    this.text = f75();
  }
}
function f76() {
  return new F76().text;
}
function f77Holder() {
  return { text: f76() };
}
function F77() {
  return f77Holder();
}
function f77() {
  return new F77().text;
}
function f78Holder() {
  return { text: f77() };
}
function F78() {
  this.level = 78;
  return f78Holder();
}
function f78() {
  return (made & 1 ? new F78() : F78.call({})).text;
}
class F79 {
  constructor() {
    this.text = f78();
  }
}
function f79() {
  return new F79().text;
}
class F80Base {
  constructor() {
    this.text = f79();
  }
}
class F80 extends F80Base {}
function f80() {
  return new F80().text;
}
class F81 {
  constructor() {
    this.text = f80();
  }
}
function f81() {
  return new F81().text;
}
function F82() {
  return { text: f81() };
}
function f82() {
  return new F82().text;
}
class F83 {
  constructor() {
    this.text = f82();
  }
}
function f83() {
  return new F83().text;
}
function f84Holder() {
  return { text: f83() };
}
function F84() {
  return f84Holder();
}
function f84() {
  return new F84().text;
}
function f85Holder() {
  return { text: f84() };
}
function F85() {
  this.level = 85;
  return f85Holder();
}
function f85() {
  return (made & 1 ? new F85() : F85.call({})).text;
}
class F86 {
  constructor() {
    this.text = f85();
  }
}
function f86() {
  return new F86().text;
}
class F87Base {
  constructor() {
    this.text = f86();
  }
}
class F87 extends F87Base {}
function f87() {
  return new F87().text;
}
class F88 {
  constructor() {
    this.text = f87();
  }
}
function f88() {
  return new F88().text;
}
function F89() {
  return { text: f88() };
}
function f89() {
  return new F89().text;
}
class F90 {
  constructor() {
    this.text = f89();
  }
}
function f90() {
  return new F90().text;
}
function f91Holder() {
  return { text: f90() };
}
function F91() {
  return f91Holder();
}
function f91() {
  return new F91().text;
}
function f92Holder() {
  return { text: f91() };
}
function F92() {
  this.level = 92;
  return f92Holder();
}
function f92() {
  return (made & 1 ? new F92() : F92.call({})).text;
}
class F93 {
  constructor() {
    this.text = f92();
  }
}
function f93() {
  return new F93().text;
}
class F94Base {
  constructor() {
    this.text = f93();
  }
}
class F94 extends F94Base {}
function f94() {
  return new F94().text;
}
class F95 {
  constructor() {
    this.text = f94();
  }
}
function f95() {
  return new F95().text;
}
function F96() {
  return { text: f95() };
}
function f96() {
  return new F96().text;
}
class F97 {
  constructor() {
    this.text = f96();
  }
}
function f97() {
  return new F97().text;
}
function f98Holder() {
  return { text: f97() };
}
function F98() {
  return f98Holder();
}
function f98() {
  return new F98().text;
}
function f99Holder() {
  return { text: f98() };
}
function F99() {
  this.level = 99;
  return f99Holder();
}
function f99() {
  return (made & 1 ? new F99() : F99.call({})).text;
}
class F100 {
  constructor() {
    this.text = f99();
  }
}
function f100() {
  return new F100().text;
}
function g0() {
  made++;
  return frames(new Error("g"));
}
class G1 {
  constructor() {
    this.text = g0();
  }
}
function g1() {
  return new G1().text;
}
class G2Base {
  constructor() {
    this.text = g1();
  }
}
class G2 extends G2Base {}
function g2() {
  return new G2().text;
}
class G3 {
  constructor() {
    this.text = g2();
  }
}
function g3() {
  return new G3().text;
}
function G4() {
  return { text: g3() };
}
function g4() {
  return new G4().text;
}
class G5 {
  constructor() {
    this.text = g4();
  }
}
function g5() {
  return new G5().text;
}
function g6Holder() {
  return { text: g5() };
}
function G6() {
  return g6Holder();
}
function g6() {
  return new G6().text;
}
function g7Holder() {
  return { text: g6() };
}
function G7() {
  this.level = 7;
  return g7Holder();
}
function g7() {
  return (made & 1 ? new G7() : G7.call({})).text;
}
class G8 {
  constructor() {
    this.text = g7();
  }
}
function g8() {
  return new G8().text;
}
class G9Base {
  constructor() {
    this.text = g8();
  }
}
class G9 extends G9Base {}
function g9() {
  return new G9().text;
}
class G10 {
  constructor() {
    this.text = g9();
  }
}
function g10() {
  return new G10().text;
}
function G11() {
  return { text: g10() };
}
function g11() {
  return new G11().text;
}
class G12 {
  constructor() {
    this.text = g11();
  }
}
function g12() {
  return new G12().text;
}
function g13Holder() {
  return { text: g12() };
}
function G13() {
  return g13Holder();
}
function g13() {
  return new G13().text;
}
function g14Holder() {
  return { text: g13() };
}
function G14() {
  this.level = 14;
  return g14Holder();
}
function g14() {
  return (made & 1 ? new G14() : G14.call({})).text;
}
class G15 {
  constructor() {
    this.text = g14();
  }
}
function g15() {
  return new G15().text;
}
class G16Base {
  constructor() {
    this.text = g15();
  }
}
class G16 extends G16Base {}
function g16() {
  return new G16().text;
}
class G17 {
  constructor() {
    this.text = g16();
  }
}
function g17() {
  return new G17().text;
}
function G18() {
  return { text: g17() };
}
function g18() {
  return new G18().text;
}
class G19 {
  constructor() {
    this.text = g18();
  }
}
function g19() {
  return new G19().text;
}
function g20Holder() {
  return { text: g19() };
}
function G20() {
  return g20Holder();
}
function g20() {
  return new G20().text;
}
function g21Holder() {
  return { text: g20() };
}
function G21() {
  this.level = 21;
  return g21Holder();
}
function g21() {
  return (made & 1 ? new G21() : G21.call({})).text;
}
class G22 {
  constructor() {
    this.text = g21();
  }
}
function g22() {
  return new G22().text;
}
class G23Base {
  constructor() {
    this.text = g22();
  }
}
class G23 extends G23Base {}
function g23() {
  return new G23().text;
}
class G24 {
  constructor() {
    this.text = g23();
  }
}
function g24() {
  return new G24().text;
}
function G25() {
  return { text: g24() };
}
function g25() {
  return new G25().text;
}
class G26 {
  constructor() {
    this.text = g25();
  }
}
function g26() {
  return new G26().text;
}
function g27Holder() {
  return { text: g26() };
}
function G27() {
  return g27Holder();
}
function g27() {
  return new G27().text;
}
function g28Holder() {
  return { text: g27() };
}
function G28() {
  this.level = 28;
  return g28Holder();
}
function g28() {
  return (made & 1 ? new G28() : G28.call({})).text;
}
class G29 {
  constructor() {
    this.text = g28();
  }
}
function g29() {
  return new G29().text;
}
class G30Base {
  constructor() {
    this.text = g29();
  }
}
class G30 extends G30Base {}
function g30() {
  return new G30().text;
}
class G31 {
  constructor() {
    this.text = g30();
  }
}
function g31() {
  return new G31().text;
}
function G32() {
  return { text: g31() };
}
function g32() {
  return new G32().text;
}
class G33 {
  constructor() {
    this.text = g32();
  }
}
function g33() {
  return new G33().text;
}
function g34Holder() {
  return { text: g33() };
}
function G34() {
  return g34Holder();
}
function g34() {
  return new G34().text;
}
function g35Holder() {
  return { text: g34() };
}
function G35() {
  this.level = 35;
  return g35Holder();
}
function g35() {
  return (made & 1 ? new G35() : G35.call({})).text;
}
class G36 {
  constructor() {
    this.text = g35();
  }
}
function g36() {
  return new G36().text;
}
class G37Base {
  constructor() {
    this.text = g36();
  }
}
class G37 extends G37Base {}
function g37() {
  return new G37().text;
}
class G38 {
  constructor() {
    this.text = g37();
  }
}
function g38() {
  return new G38().text;
}
function G39() {
  return { text: g38() };
}
function g39() {
  return new G39().text;
}
class G40 {
  constructor() {
    this.text = g39();
  }
}
function g40() {
  return new G40().text;
}
function g41Holder() {
  return { text: g40() };
}
function G41() {
  return g41Holder();
}
function g41() {
  return new G41().text;
}
function g42Holder() {
  return { text: g41() };
}
function G42() {
  this.level = 42;
  return g42Holder();
}
function g42() {
  return (made & 1 ? new G42() : G42.call({})).text;
}
class G43 {
  constructor() {
    this.text = g42();
  }
}
function g43() {
  return new G43().text;
}
class G44Base {
  constructor() {
    this.text = g43();
  }
}
class G44 extends G44Base {}
function g44() {
  return new G44().text;
}
class G45 {
  constructor() {
    this.text = g44();
  }
}
function g45() {
  return new G45().text;
}
function G46() {
  return { text: g45() };
}
function g46() {
  return new G46().text;
}
class G47 {
  constructor() {
    this.text = g46();
  }
}
function g47() {
  return new G47().text;
}
function g48Holder() {
  return { text: g47() };
}
function G48() {
  return g48Holder();
}
function g48() {
  return new G48().text;
}
function g49Holder() {
  return { text: g48() };
}
function G49() {
  this.level = 49;
  return g49Holder();
}
function g49() {
  return (made & 1 ? new G49() : G49.call({})).text;
}
class G50 {
  constructor() {
    this.text = g49();
  }
}
function g50() {
  return new G50().text;
}
class G51Base {
  constructor() {
    this.text = g50();
  }
}
class G51 extends G51Base {}
function g51() {
  return new G51().text;
}
class G52 {
  constructor() {
    this.text = g51();
  }
}
function g52() {
  return new G52().text;
}
function G53() {
  return { text: g52() };
}
function g53() {
  return new G53().text;
}
class G54 {
  constructor() {
    this.text = g53();
  }
}
function g54() {
  return new G54().text;
}
function g55Holder() {
  return { text: g54() };
}
function G55() {
  return g55Holder();
}
function g55() {
  return new G55().text;
}
function g56Holder() {
  return { text: g55() };
}
function G56() {
  this.level = 56;
  return g56Holder();
}
function g56() {
  return (made & 1 ? new G56() : G56.call({})).text;
}
class G57 {
  constructor() {
    this.text = g56();
  }
}
function g57() {
  return new G57().text;
}
class G58Base {
  constructor() {
    this.text = g57();
  }
}
class G58 extends G58Base {}
function g58() {
  return new G58().text;
}
class G59 {
  constructor() {
    this.text = g58();
  }
}
function g59() {
  return new G59().text;
}
function G60() {
  return { text: g59() };
}
function g60() {
  return new G60().text;
}
class G61 {
  constructor() {
    this.text = g60();
  }
}
function g61() {
  return new G61().text;
}
function g62Holder() {
  return { text: g61() };
}
function G62() {
  return g62Holder();
}
function g62() {
  return new G62().text;
}
function g63Holder() {
  return { text: g62() };
}
function G63() {
  this.level = 63;
  return g63Holder();
}
function g63() {
  return (made & 1 ? new G63() : G63.call({})).text;
}
class G64 {
  constructor() {
    this.text = g63();
  }
}
function g64() {
  return new G64().text;
}
class G65Base {
  constructor() {
    this.text = g64();
  }
}
class G65 extends G65Base {}
function g65() {
  return new G65().text;
}
class G66 {
  constructor() {
    this.text = g65();
  }
}
function g66() {
  return new G66().text;
}
function G67() {
  return { text: g66() };
}
function g67() {
  return new G67().text;
}
class G68 {
  constructor() {
    this.text = g67();
  }
}
function g68() {
  return new G68().text;
}
function g69Holder() {
  return { text: g68() };
}
function G69() {
  return g69Holder();
}
function g69() {
  return new G69().text;
}
function g70Holder() {
  return { text: g69() };
}
function G70() {
  this.level = 70;
  return g70Holder();
}
function g70() {
  return (made & 1 ? new G70() : G70.call({})).text;
}
class G71 {
  constructor() {
    this.text = g70();
  }
}
function g71() {
  return new G71().text;
}
class G72Base {
  constructor() {
    this.text = g71();
  }
}
class G72 extends G72Base {}
function g72() {
  return new G72().text;
}
class G73 {
  constructor() {
    this.text = g72();
  }
}
function g73() {
  return new G73().text;
}
function G74() {
  return { text: g73() };
}
function g74() {
  return new G74().text;
}
class G75 {
  constructor() {
    this.text = g74();
  }
}
function g75() {
  return new G75().text;
}
function g76Holder() {
  return { text: g75() };
}
function G76() {
  return g76Holder();
}
function g76() {
  return new G76().text;
}
function g77Holder() {
  return { text: g76() };
}
function G77() {
  this.level = 77;
  return g77Holder();
}
function g77() {
  return (made & 1 ? new G77() : G77.call({})).text;
}
class G78 {
  constructor() {
    this.text = g77();
  }
}
function g78() {
  return new G78().text;
}
class G79Base {
  constructor() {
    this.text = g78();
  }
}
class G79 extends G79Base {}
function g79() {
  return new G79().text;
}
class G80 {
  constructor() {
    this.text = g79();
  }
}
function g80() {
  return new G80().text;
}
function G81() {
  return { text: g80() };
}
function g81() {
  return new G81().text;
}
class G82 {
  constructor() {
    this.text = g81();
  }
}
function g82() {
  return new G82().text;
}
function g83Holder() {
  return { text: g82() };
}
function G83() {
  return g83Holder();
}
function g83() {
  return new G83().text;
}
function g84Holder() {
  return { text: g83() };
}
function G84() {
  this.level = 84;
  return g84Holder();
}
function g84() {
  return (made & 1 ? new G84() : G84.call({})).text;
}
class G85 {
  constructor() {
    this.text = g84();
  }
}
function g85() {
  return new G85().text;
}
class G86Base {
  constructor() {
    this.text = g85();
  }
}
class G86 extends G86Base {}
function g86() {
  return new G86().text;
}
class G87 {
  constructor() {
    this.text = g86();
  }
}
function g87() {
  return new G87().text;
}
function G88() {
  return { text: g87() };
}
function g88() {
  return new G88().text;
}
class G89 {
  constructor() {
    this.text = g88();
  }
}
function g89() {
  return new G89().text;
}
function g90Holder() {
  return { text: g89() };
}
function G90() {
  return g90Holder();
}
function g90() {
  return new G90().text;
}
function g91Holder() {
  return { text: g90() };
}
function G91() {
  this.level = 91;
  return g91Holder();
}
function g91() {
  return (made & 1 ? new G91() : G91.call({})).text;
}
class G92 {
  constructor() {
    this.text = g91();
  }
}
function g92() {
  return new G92().text;
}
class G93Base {
  constructor() {
    this.text = g92();
  }
}
class G93 extends G93Base {}
function g93() {
  return new G93().text;
}
class G94 {
  constructor() {
    this.text = g93();
  }
}
function g94() {
  return new G94().text;
}
function G95() {
  return { text: g94() };
}
function g95() {
  return new G95().text;
}
class G96 {
  constructor() {
    this.text = g95();
  }
}
function g96() {
  return new G96().text;
}
function g97Holder() {
  return { text: g96() };
}
function G97() {
  return g97Holder();
}
function g97() {
  return new G97().text;
}
function g98Holder() {
  return { text: g97() };
}
function G98() {
  this.level = 98;
  return g98Holder();
}
function g98() {
  return (made & 1 ? new G98() : G98.call({})).text;
}
class G99 {
  constructor() {
    this.text = g98();
  }
}
function g99() {
  return new G99().text;
}
class G100Base {
  constructor() {
    this.text = g99();
  }
}
class G100 extends G100Base {}
function g100() {
  return new G100().text;
}
function h0() {
  made++;
  return frames(new Error("h"));
}
class H1Base {
  constructor() {
    this.text = h0();
  }
}
class H1 extends H1Base {}
function h1() {
  return new H1().text;
}
class H2 {
  constructor() {
    this.text = h1();
  }
}
function h2() {
  return new H2().text;
}
function H3() {
  return { text: h2() };
}
function h3() {
  return new H3().text;
}
class H4 {
  constructor() {
    this.text = h3();
  }
}
function h4() {
  return new H4().text;
}
function h5Holder() {
  return { text: h4() };
}
function H5() {
  return h5Holder();
}
function h5() {
  return new H5().text;
}
function h6Holder() {
  return { text: h5() };
}
function H6() {
  this.level = 6;
  return h6Holder();
}
function h6() {
  return (made & 1 ? new H6() : H6.call({})).text;
}
class H7 {
  constructor() {
    this.text = h6();
  }
}
function h7() {
  return new H7().text;
}
class H8Base {
  constructor() {
    this.text = h7();
  }
}
class H8 extends H8Base {}
function h8() {
  return new H8().text;
}
class H9 {
  constructor() {
    this.text = h8();
  }
}
function h9() {
  return new H9().text;
}
function H10() {
  return { text: h9() };
}
function h10() {
  return new H10().text;
}
class H11 {
  constructor() {
    this.text = h10();
  }
}
function h11() {
  return new H11().text;
}
function h12Holder() {
  return { text: h11() };
}
function H12() {
  return h12Holder();
}
function h12() {
  return new H12().text;
}
function h13Holder() {
  return { text: h12() };
}
function H13() {
  this.level = 13;
  return h13Holder();
}
function h13() {
  return (made & 1 ? new H13() : H13.call({})).text;
}
class H14 {
  constructor() {
    this.text = h13();
  }
}
function h14() {
  return new H14().text;
}
class H15Base {
  constructor() {
    this.text = h14();
  }
}
class H15 extends H15Base {}
function h15() {
  return new H15().text;
}
class H16 {
  constructor() {
    this.text = h15();
  }
}
function h16() {
  return new H16().text;
}
function H17() {
  return { text: h16() };
}
function h17() {
  return new H17().text;
}
class H18 {
  constructor() {
    this.text = h17();
  }
}
function h18() {
  return new H18().text;
}
function h19Holder() {
  return { text: h18() };
}
function H19() {
  return h19Holder();
}
function h19() {
  return new H19().text;
}
function h20Holder() {
  return { text: h19() };
}
function H20() {
  this.level = 20;
  return h20Holder();
}
function h20() {
  return (made & 1 ? new H20() : H20.call({})).text;
}
class H21 {
  constructor() {
    this.text = h20();
  }
}
function h21() {
  return new H21().text;
}
class H22Base {
  constructor() {
    this.text = h21();
  }
}
class H22 extends H22Base {}
function h22() {
  return new H22().text;
}
class H23 {
  constructor() {
    this.text = h22();
  }
}
function h23() {
  return new H23().text;
}
function H24() {
  return { text: h23() };
}
function h24() {
  return new H24().text;
}
class H25 {
  constructor() {
    this.text = h24();
  }
}
function h25() {
  return new H25().text;
}
function h26Holder() {
  return { text: h25() };
}
function H26() {
  return h26Holder();
}
function h26() {
  return new H26().text;
}
function h27Holder() {
  return { text: h26() };
}
function H27() {
  this.level = 27;
  return h27Holder();
}
function h27() {
  return (made & 1 ? new H27() : H27.call({})).text;
}
class H28 {
  constructor() {
    this.text = h27();
  }
}
function h28() {
  return new H28().text;
}
class H29Base {
  constructor() {
    this.text = h28();
  }
}
class H29 extends H29Base {}
function h29() {
  return new H29().text;
}
class H30 {
  constructor() {
    this.text = h29();
  }
}
function h30() {
  return new H30().text;
}
function H31() {
  return { text: h30() };
}
function h31() {
  return new H31().text;
}
class H32 {
  constructor() {
    this.text = h31();
  }
}
function h32() {
  return new H32().text;
}
function h33Holder() {
  return { text: h32() };
}
function H33() {
  return h33Holder();
}
function h33() {
  return new H33().text;
}
function h34Holder() {
  return { text: h33() };
}
function H34() {
  this.level = 34;
  return h34Holder();
}
function h34() {
  return (made & 1 ? new H34() : H34.call({})).text;
}
class H35 {
  constructor() {
    this.text = h34();
  }
}
function h35() {
  return new H35().text;
}
class H36Base {
  constructor() {
    this.text = h35();
  }
}
class H36 extends H36Base {}
function h36() {
  return new H36().text;
}
class H37 {
  constructor() {
    this.text = h36();
  }
}
function h37() {
  return new H37().text;
}
function H38() {
  return { text: h37() };
}
function h38() {
  return new H38().text;
}
class H39 {
  constructor() {
    this.text = h38();
  }
}
function h39() {
  return new H39().text;
}
function h40Holder() {
  return { text: h39() };
}
function H40() {
  return h40Holder();
}
function h40() {
  return new H40().text;
}
function h41Holder() {
  return { text: h40() };
}
function H41() {
  this.level = 41;
  return h41Holder();
}
function h41() {
  return (made & 1 ? new H41() : H41.call({})).text;
}
class H42 {
  constructor() {
    this.text = h41();
  }
}
function h42() {
  return new H42().text;
}
class H43Base {
  constructor() {
    this.text = h42();
  }
}
class H43 extends H43Base {}
function h43() {
  return new H43().text;
}
class H44 {
  constructor() {
    this.text = h43();
  }
}
function h44() {
  return new H44().text;
}
function H45() {
  return { text: h44() };
}
function h45() {
  return new H45().text;
}
class H46 {
  constructor() {
    this.text = h45();
  }
}
function h46() {
  return new H46().text;
}
function h47Holder() {
  return { text: h46() };
}
function H47() {
  return h47Holder();
}
function h47() {
  return new H47().text;
}
function h48Holder() {
  return { text: h47() };
}
function H48() {
  this.level = 48;
  return h48Holder();
}
function h48() {
  return (made & 1 ? new H48() : H48.call({})).text;
}
class H49 {
  constructor() {
    this.text = h48();
  }
}
function h49() {
  return new H49().text;
}
class H50Base {
  constructor() {
    this.text = h49();
  }
}
class H50 extends H50Base {}
function h50() {
  return new H50().text;
}
class H51 {
  constructor() {
    this.text = h50();
  }
}
function h51() {
  return new H51().text;
}
function H52() {
  return { text: h51() };
}
function h52() {
  return new H52().text;
}
class H53 {
  constructor() {
    this.text = h52();
  }
}
function h53() {
  return new H53().text;
}
function h54Holder() {
  return { text: h53() };
}
function H54() {
  return h54Holder();
}
function h54() {
  return new H54().text;
}
function h55Holder() {
  return { text: h54() };
}
function H55() {
  this.level = 55;
  return h55Holder();
}
function h55() {
  return (made & 1 ? new H55() : H55.call({})).text;
}
class H56 {
  constructor() {
    this.text = h55();
  }
}
function h56() {
  return new H56().text;
}
class H57Base {
  constructor() {
    this.text = h56();
  }
}
class H57 extends H57Base {}
function h57() {
  return new H57().text;
}
class H58 {
  constructor() {
    this.text = h57();
  }
}
function h58() {
  return new H58().text;
}
function H59() {
  return { text: h58() };
}
function h59() {
  return new H59().text;
}
class H60 {
  constructor() {
    this.text = h59();
  }
}
function h60() {
  return new H60().text;
}
function h61Holder() {
  return { text: h60() };
}
function H61() {
  return h61Holder();
}
function h61() {
  return new H61().text;
}
function h62Holder() {
  return { text: h61() };
}
function H62() {
  this.level = 62;
  return h62Holder();
}
function h62() {
  return (made & 1 ? new H62() : H62.call({})).text;
}
class H63 {
  constructor() {
    this.text = h62();
  }
}
function h63() {
  return new H63().text;
}
class H64Base {
  constructor() {
    this.text = h63();
  }
}
class H64 extends H64Base {}
function h64() {
  return new H64().text;
}
class H65 {
  constructor() {
    this.text = h64();
  }
}
function h65() {
  return new H65().text;
}
function H66() {
  return { text: h65() };
}
function h66() {
  return new H66().text;
}
class H67 {
  constructor() {
    this.text = h66();
  }
}
function h67() {
  return new H67().text;
}
function h68Holder() {
  return { text: h67() };
}
function H68() {
  return h68Holder();
}
function h68() {
  return new H68().text;
}
function h69Holder() {
  return { text: h68() };
}
function H69() {
  this.level = 69;
  return h69Holder();
}
function h69() {
  return (made & 1 ? new H69() : H69.call({})).text;
}
class H70 {
  constructor() {
    this.text = h69();
  }
}
function h70() {
  return new H70().text;
}
class H71Base {
  constructor() {
    this.text = h70();
  }
}
class H71 extends H71Base {}
function h71() {
  return new H71().text;
}
class H72 {
  constructor() {
    this.text = h71();
  }
}
function h72() {
  return new H72().text;
}
function H73() {
  return { text: h72() };
}
function h73() {
  return new H73().text;
}
class H74 {
  constructor() {
    this.text = h73();
  }
}
function h74() {
  return new H74().text;
}
function h75Holder() {
  return { text: h74() };
}
function H75() {
  return h75Holder();
}
function h75() {
  return new H75().text;
}
function h76Holder() {
  return { text: h75() };
}
function H76() {
  this.level = 76;
  return h76Holder();
}
function h76() {
  return (made & 1 ? new H76() : H76.call({})).text;
}
class H77 {
  constructor() {
    this.text = h76();
  }
}
function h77() {
  return new H77().text;
}
class H78Base {
  constructor() {
    this.text = h77();
  }
}
class H78 extends H78Base {}
function h78() {
  return new H78().text;
}
class H79 {
  constructor() {
    this.text = h78();
  }
}
function h79() {
  return new H79().text;
}
function H80() {
  return { text: h79() };
}
function h80() {
  return new H80().text;
}
class H81 {
  constructor() {
    this.text = h80();
  }
}
function h81() {
  return new H81().text;
}
function h82Holder() {
  return { text: h81() };
}
function H82() {
  return h82Holder();
}
function h82() {
  return new H82().text;
}
function h83Holder() {
  return { text: h82() };
}
function H83() {
  this.level = 83;
  return h83Holder();
}
function h83() {
  return (made & 1 ? new H83() : H83.call({})).text;
}
class H84 {
  constructor() {
    this.text = h83();
  }
}
function h84() {
  return new H84().text;
}
class H85Base {
  constructor() {
    this.text = h84();
  }
}
class H85 extends H85Base {}
function h85() {
  return new H85().text;
}
class H86 {
  constructor() {
    this.text = h85();
  }
}
function h86() {
  return new H86().text;
}
function H87() {
  return { text: h86() };
}
function h87() {
  return new H87().text;
}
class H88 {
  constructor() {
    this.text = h87();
  }
}
function h88() {
  return new H88().text;
}
function h89Holder() {
  return { text: h88() };
}
function H89() {
  return h89Holder();
}
function h89() {
  return new H89().text;
}
function h90Holder() {
  return { text: h89() };
}
function H90() {
  this.level = 90;
  return h90Holder();
}
function h90() {
  return (made & 1 ? new H90() : H90.call({})).text;
}
class H91 {
  constructor() {
    this.text = h90();
  }
}
function h91() {
  return new H91().text;
}
class H92Base {
  constructor() {
    this.text = h91();
  }
}
class H92 extends H92Base {}
function h92() {
  return new H92().text;
}
class H93 {
  constructor() {
    this.text = h92();
  }
}
function h93() {
  return new H93().text;
}
function H94() {
  return { text: h93() };
}
function h94() {
  return new H94().text;
}
class H95 {
  constructor() {
    this.text = h94();
  }
}
function h95() {
  return new H95().text;
}
function h96Holder() {
  return { text: h95() };
}
function H96() {
  return h96Holder();
}
function h96() {
  return new H96().text;
}
function h97Holder() {
  return { text: h96() };
}
function H97() {
  this.level = 97;
  return h97Holder();
}
function h97() {
  return (made & 1 ? new H97() : H97.call({})).text;
}
class H98 {
  constructor() {
    this.text = h97();
  }
}
function h98() {
  return new H98().text;
}
class H99Base {
  constructor() {
    this.text = h98();
  }
}
class H99 extends H99Base {}
function h99() {
  return new H99().text;
}
class H100 {
  constructor() {
    this.text = h99();
  }
}
function h100() {
  return new H100().text;
}
function i0() {
  made++;
  return frames(new Error("i"));
}
class I1 {
  constructor() {
    this.text = i0();
  }
}
function i1() {
  return new I1().text;
}
function I2() {
  return { text: i1() };
}
function i2() {
  return new I2().text;
}
class I3 {
  constructor() {
    this.text = i2();
  }
}
function i3() {
  return new I3().text;
}
function i4Holder() {
  return { text: i3() };
}
function I4() {
  return i4Holder();
}
function i4() {
  return new I4().text;
}
function i5Holder() {
  return { text: i4() };
}
function I5() {
  this.level = 5;
  return i5Holder();
}
function i5() {
  return (made & 1 ? new I5() : I5.call({})).text;
}
class I6 {
  constructor() {
    this.text = i5();
  }
}
function i6() {
  return new I6().text;
}
class I7Base {
  constructor() {
    this.text = i6();
  }
}
class I7 extends I7Base {}
function i7() {
  return new I7().text;
}
class I8 {
  constructor() {
    this.text = i7();
  }
}
function i8() {
  return new I8().text;
}
function I9() {
  return { text: i8() };
}
function i9() {
  return new I9().text;
}
class I10 {
  constructor() {
    this.text = i9();
  }
}
function i10() {
  return new I10().text;
}
function i11Holder() {
  return { text: i10() };
}
function I11() {
  return i11Holder();
}
function i11() {
  return new I11().text;
}
function i12Holder() {
  return { text: i11() };
}
function I12() {
  this.level = 12;
  return i12Holder();
}
function i12() {
  return (made & 1 ? new I12() : I12.call({})).text;
}
class I13 {
  constructor() {
    this.text = i12();
  }
}
function i13() {
  return new I13().text;
}
class I14Base {
  constructor() {
    this.text = i13();
  }
}
class I14 extends I14Base {}
function i14() {
  return new I14().text;
}
class I15 {
  constructor() {
    this.text = i14();
  }
}
function i15() {
  return new I15().text;
}
function I16() {
  return { text: i15() };
}
function i16() {
  return new I16().text;
}
class I17 {
  constructor() {
    this.text = i16();
  }
}
function i17() {
  return new I17().text;
}
function i18Holder() {
  return { text: i17() };
}
function I18() {
  return i18Holder();
}
function i18() {
  return new I18().text;
}
function i19Holder() {
  return { text: i18() };
}
function I19() {
  this.level = 19;
  return i19Holder();
}
function i19() {
  return (made & 1 ? new I19() : I19.call({})).text;
}
class I20 {
  constructor() {
    this.text = i19();
  }
}
function i20() {
  return new I20().text;
}
class I21Base {
  constructor() {
    this.text = i20();
  }
}
class I21 extends I21Base {}
function i21() {
  return new I21().text;
}
class I22 {
  constructor() {
    this.text = i21();
  }
}
function i22() {
  return new I22().text;
}
function I23() {
  return { text: i22() };
}
function i23() {
  return new I23().text;
}
class I24 {
  constructor() {
    this.text = i23();
  }
}
function i24() {
  return new I24().text;
}
function i25Holder() {
  return { text: i24() };
}
function I25() {
  return i25Holder();
}
function i25() {
  return new I25().text;
}
function i26Holder() {
  return { text: i25() };
}
function I26() {
  this.level = 26;
  return i26Holder();
}
function i26() {
  return (made & 1 ? new I26() : I26.call({})).text;
}
class I27 {
  constructor() {
    this.text = i26();
  }
}
function i27() {
  return new I27().text;
}
class I28Base {
  constructor() {
    this.text = i27();
  }
}
class I28 extends I28Base {}
function i28() {
  return new I28().text;
}
class I29 {
  constructor() {
    this.text = i28();
  }
}
function i29() {
  return new I29().text;
}
function I30() {
  return { text: i29() };
}
function i30() {
  return new I30().text;
}
class I31 {
  constructor() {
    this.text = i30();
  }
}
function i31() {
  return new I31().text;
}
function i32Holder() {
  return { text: i31() };
}
function I32() {
  return i32Holder();
}
function i32() {
  return new I32().text;
}
function i33Holder() {
  return { text: i32() };
}
function I33() {
  this.level = 33;
  return i33Holder();
}
function i33() {
  return (made & 1 ? new I33() : I33.call({})).text;
}
class I34 {
  constructor() {
    this.text = i33();
  }
}
function i34() {
  return new I34().text;
}
class I35Base {
  constructor() {
    this.text = i34();
  }
}
class I35 extends I35Base {}
function i35() {
  return new I35().text;
}
class I36 {
  constructor() {
    this.text = i35();
  }
}
function i36() {
  return new I36().text;
}
function I37() {
  return { text: i36() };
}
function i37() {
  return new I37().text;
}
class I38 {
  constructor() {
    this.text = i37();
  }
}
function i38() {
  return new I38().text;
}
function i39Holder() {
  return { text: i38() };
}
function I39() {
  return i39Holder();
}
function i39() {
  return new I39().text;
}
function i40Holder() {
  return { text: i39() };
}
function I40() {
  this.level = 40;
  return i40Holder();
}
function i40() {
  return (made & 1 ? new I40() : I40.call({})).text;
}
class I41 {
  constructor() {
    this.text = i40();
  }
}
function i41() {
  return new I41().text;
}
class I42Base {
  constructor() {
    this.text = i41();
  }
}
class I42 extends I42Base {}
function i42() {
  return new I42().text;
}
class I43 {
  constructor() {
    this.text = i42();
  }
}
function i43() {
  return new I43().text;
}
function I44() {
  return { text: i43() };
}
function i44() {
  return new I44().text;
}
class I45 {
  constructor() {
    this.text = i44();
  }
}
function i45() {
  return new I45().text;
}
function i46Holder() {
  return { text: i45() };
}
function I46() {
  return i46Holder();
}
function i46() {
  return new I46().text;
}
function i47Holder() {
  return { text: i46() };
}
function I47() {
  this.level = 47;
  return i47Holder();
}
function i47() {
  return (made & 1 ? new I47() : I47.call({})).text;
}
class I48 {
  constructor() {
    this.text = i47();
  }
}
function i48() {
  return new I48().text;
}
class I49Base {
  constructor() {
    this.text = i48();
  }
}
class I49 extends I49Base {}
function i49() {
  return new I49().text;
}
class I50 {
  constructor() {
    this.text = i49();
  }
}
function i50() {
  return new I50().text;
}
function I51() {
  return { text: i50() };
}
function i51() {
  return new I51().text;
}
class I52 {
  constructor() {
    this.text = i51();
  }
}
function i52() {
  return new I52().text;
}
function i53Holder() {
  return { text: i52() };
}
function I53() {
  return i53Holder();
}
function i53() {
  return new I53().text;
}
function i54Holder() {
  return { text: i53() };
}
function I54() {
  this.level = 54;
  return i54Holder();
}
function i54() {
  return (made & 1 ? new I54() : I54.call({})).text;
}
class I55 {
  constructor() {
    this.text = i54();
  }
}
function i55() {
  return new I55().text;
}
class I56Base {
  constructor() {
    this.text = i55();
  }
}
class I56 extends I56Base {}
function i56() {
  return new I56().text;
}
class I57 {
  constructor() {
    this.text = i56();
  }
}
function i57() {
  return new I57().text;
}
function I58() {
  return { text: i57() };
}
function i58() {
  return new I58().text;
}
class I59 {
  constructor() {
    this.text = i58();
  }
}
function i59() {
  return new I59().text;
}
function i60Holder() {
  return { text: i59() };
}
function I60() {
  return i60Holder();
}
function i60() {
  return new I60().text;
}
function i61Holder() {
  return { text: i60() };
}
function I61() {
  this.level = 61;
  return i61Holder();
}
function i61() {
  return (made & 1 ? new I61() : I61.call({})).text;
}
class I62 {
  constructor() {
    this.text = i61();
  }
}
function i62() {
  return new I62().text;
}
class I63Base {
  constructor() {
    this.text = i62();
  }
}
class I63 extends I63Base {}
function i63() {
  return new I63().text;
}
class I64 {
  constructor() {
    this.text = i63();
  }
}
function i64() {
  return new I64().text;
}
function I65() {
  return { text: i64() };
}
function i65() {
  return new I65().text;
}
class I66 {
  constructor() {
    this.text = i65();
  }
}
function i66() {
  return new I66().text;
}
function i67Holder() {
  return { text: i66() };
}
function I67() {
  return i67Holder();
}
function i67() {
  return new I67().text;
}
function i68Holder() {
  return { text: i67() };
}
function I68() {
  this.level = 68;
  return i68Holder();
}
function i68() {
  return (made & 1 ? new I68() : I68.call({})).text;
}
class I69 {
  constructor() {
    this.text = i68();
  }
}
function i69() {
  return new I69().text;
}
class I70Base {
  constructor() {
    this.text = i69();
  }
}
class I70 extends I70Base {}
function i70() {
  return new I70().text;
}
class I71 {
  constructor() {
    this.text = i70();
  }
}
function i71() {
  return new I71().text;
}
function I72() {
  return { text: i71() };
}
function i72() {
  return new I72().text;
}
class I73 {
  constructor() {
    this.text = i72();
  }
}
function i73() {
  return new I73().text;
}
function i74Holder() {
  return { text: i73() };
}
function I74() {
  return i74Holder();
}
function i74() {
  return new I74().text;
}
function i75Holder() {
  return { text: i74() };
}
function I75() {
  this.level = 75;
  return i75Holder();
}
function i75() {
  return (made & 1 ? new I75() : I75.call({})).text;
}
class I76 {
  constructor() {
    this.text = i75();
  }
}
function i76() {
  return new I76().text;
}
class I77Base {
  constructor() {
    this.text = i76();
  }
}
class I77 extends I77Base {}
function i77() {
  return new I77().text;
}
class I78 {
  constructor() {
    this.text = i77();
  }
}
function i78() {
  return new I78().text;
}
function I79() {
  return { text: i78() };
}
function i79() {
  return new I79().text;
}
class I80 {
  constructor() {
    this.text = i79();
  }
}
function i80() {
  return new I80().text;
}
function i81Holder() {
  return { text: i80() };
}
function I81() {
  return i81Holder();
}
function i81() {
  return new I81().text;
}
function i82Holder() {
  return { text: i81() };
}
function I82() {
  this.level = 82;
  return i82Holder();
}
function i82() {
  return (made & 1 ? new I82() : I82.call({})).text;
}
class I83 {
  constructor() {
    this.text = i82();
  }
}
function i83() {
  return new I83().text;
}
class I84Base {
  constructor() {
    this.text = i83();
  }
}
class I84 extends I84Base {}
function i84() {
  return new I84().text;
}
class I85 {
  constructor() {
    this.text = i84();
  }
}
function i85() {
  return new I85().text;
}
function I86() {
  return { text: i85() };
}
function i86() {
  return new I86().text;
}
class I87 {
  constructor() {
    this.text = i86();
  }
}
function i87() {
  return new I87().text;
}
function i88Holder() {
  return { text: i87() };
}
function I88() {
  return i88Holder();
}
function i88() {
  return new I88().text;
}
function i89Holder() {
  return { text: i88() };
}
function I89() {
  this.level = 89;
  return i89Holder();
}
function i89() {
  return (made & 1 ? new I89() : I89.call({})).text;
}
class I90 {
  constructor() {
    this.text = i89();
  }
}
function i90() {
  return new I90().text;
}
class I91Base {
  constructor() {
    this.text = i90();
  }
}
class I91 extends I91Base {}
function i91() {
  return new I91().text;
}
class I92 {
  constructor() {
    this.text = i91();
  }
}
function i92() {
  return new I92().text;
}
function I93() {
  return { text: i92() };
}
function i93() {
  return new I93().text;
}
class I94 {
  constructor() {
    this.text = i93();
  }
}
function i94() {
  return new I94().text;
}
function i95Holder() {
  return { text: i94() };
}
function I95() {
  return i95Holder();
}
function i95() {
  return new I95().text;
}
function i96Holder() {
  return { text: i95() };
}
function I96() {
  this.level = 96;
  return i96Holder();
}
function i96() {
  return (made & 1 ? new I96() : I96.call({})).text;
}
class I97 {
  constructor() {
    this.text = i96();
  }
}
function i97() {
  return new I97().text;
}
class I98Base {
  constructor() {
    this.text = i97();
  }
}
class I98 extends I98Base {}
function i98() {
  return new I98().text;
}
class I99 {
  constructor() {
    this.text = i98();
  }
}
function i99() {
  return new I99().text;
}
function I100() {
  return { text: i99() };
}
function i100() {
  return new I100().text;
}
function j0() {
  made++;
  return frames(new Error("j"));
}
function J1() {
  return { text: j0() };
}
function j1() {
  return new J1().text;
}
class J2 {
  constructor() {
    this.text = j1();
  }
}
function j2() {
  return new J2().text;
}
function j3Holder() {
  return { text: j2() };
}
function J3() {
  return j3Holder();
}
function j3() {
  return new J3().text;
}
function j4Holder() {
  return { text: j3() };
}
function J4() {
  this.level = 4;
  return j4Holder();
}
function j4() {
  return (made & 1 ? new J4() : J4.call({})).text;
}
class J5 {
  constructor() {
    this.text = j4();
  }
}
function j5() {
  return new J5().text;
}
class J6Base {
  constructor() {
    this.text = j5();
  }
}
class J6 extends J6Base {}
function j6() {
  return new J6().text;
}
class J7 {
  constructor() {
    this.text = j6();
  }
}
function j7() {
  return new J7().text;
}
function J8() {
  return { text: j7() };
}
function j8() {
  return new J8().text;
}
class J9 {
  constructor() {
    this.text = j8();
  }
}
function j9() {
  return new J9().text;
}
function j10Holder() {
  return { text: j9() };
}
function J10() {
  return j10Holder();
}
function j10() {
  return new J10().text;
}
function j11Holder() {
  return { text: j10() };
}
function J11() {
  this.level = 11;
  return j11Holder();
}
function j11() {
  return (made & 1 ? new J11() : J11.call({})).text;
}
class J12 {
  constructor() {
    this.text = j11();
  }
}
function j12() {
  return new J12().text;
}
class J13Base {
  constructor() {
    this.text = j12();
  }
}
class J13 extends J13Base {}
function j13() {
  return new J13().text;
}
class J14 {
  constructor() {
    this.text = j13();
  }
}
function j14() {
  return new J14().text;
}
function J15() {
  return { text: j14() };
}
function j15() {
  return new J15().text;
}
class J16 {
  constructor() {
    this.text = j15();
  }
}
function j16() {
  return new J16().text;
}
function j17Holder() {
  return { text: j16() };
}
function J17() {
  return j17Holder();
}
function j17() {
  return new J17().text;
}
function j18Holder() {
  return { text: j17() };
}
function J18() {
  this.level = 18;
  return j18Holder();
}
function j18() {
  return (made & 1 ? new J18() : J18.call({})).text;
}
class J19 {
  constructor() {
    this.text = j18();
  }
}
function j19() {
  return new J19().text;
}
class J20Base {
  constructor() {
    this.text = j19();
  }
}
class J20 extends J20Base {}
function j20() {
  return new J20().text;
}
class J21 {
  constructor() {
    this.text = j20();
  }
}
function j21() {
  return new J21().text;
}
function J22() {
  return { text: j21() };
}
function j22() {
  return new J22().text;
}
class J23 {
  constructor() {
    this.text = j22();
  }
}
function j23() {
  return new J23().text;
}
function j24Holder() {
  return { text: j23() };
}
function J24() {
  return j24Holder();
}
function j24() {
  return new J24().text;
}
function j25Holder() {
  return { text: j24() };
}
function J25() {
  this.level = 25;
  return j25Holder();
}
function j25() {
  return (made & 1 ? new J25() : J25.call({})).text;
}
class J26 {
  constructor() {
    this.text = j25();
  }
}
function j26() {
  return new J26().text;
}
class J27Base {
  constructor() {
    this.text = j26();
  }
}
class J27 extends J27Base {}
function j27() {
  return new J27().text;
}
class J28 {
  constructor() {
    this.text = j27();
  }
}
function j28() {
  return new J28().text;
}
function J29() {
  return { text: j28() };
}
function j29() {
  return new J29().text;
}
class J30 {
  constructor() {
    this.text = j29();
  }
}
function j30() {
  return new J30().text;
}
function j31Holder() {
  return { text: j30() };
}
function J31() {
  return j31Holder();
}
function j31() {
  return new J31().text;
}
function j32Holder() {
  return { text: j31() };
}
function J32() {
  this.level = 32;
  return j32Holder();
}
function j32() {
  return (made & 1 ? new J32() : J32.call({})).text;
}
class J33 {
  constructor() {
    this.text = j32();
  }
}
function j33() {
  return new J33().text;
}
class J34Base {
  constructor() {
    this.text = j33();
  }
}
class J34 extends J34Base {}
function j34() {
  return new J34().text;
}
class J35 {
  constructor() {
    this.text = j34();
  }
}
function j35() {
  return new J35().text;
}
function J36() {
  return { text: j35() };
}
function j36() {
  return new J36().text;
}
class J37 {
  constructor() {
    this.text = j36();
  }
}
function j37() {
  return new J37().text;
}
function j38Holder() {
  return { text: j37() };
}
function J38() {
  return j38Holder();
}
function j38() {
  return new J38().text;
}
function j39Holder() {
  return { text: j38() };
}
function J39() {
  this.level = 39;
  return j39Holder();
}
function j39() {
  return (made & 1 ? new J39() : J39.call({})).text;
}
class J40 {
  constructor() {
    this.text = j39();
  }
}
function j40() {
  return new J40().text;
}
class J41Base {
  constructor() {
    this.text = j40();
  }
}
class J41 extends J41Base {}
function j41() {
  return new J41().text;
}
class J42 {
  constructor() {
    this.text = j41();
  }
}
function j42() {
  return new J42().text;
}
function J43() {
  return { text: j42() };
}
function j43() {
  return new J43().text;
}
class J44 {
  constructor() {
    this.text = j43();
  }
}
function j44() {
  return new J44().text;
}
function j45Holder() {
  return { text: j44() };
}
function J45() {
  return j45Holder();
}
function j45() {
  return new J45().text;
}
function j46Holder() {
  return { text: j45() };
}
function J46() {
  this.level = 46;
  return j46Holder();
}
function j46() {
  return (made & 1 ? new J46() : J46.call({})).text;
}
class J47 {
  constructor() {
    this.text = j46();
  }
}
function j47() {
  return new J47().text;
}
class J48Base {
  constructor() {
    this.text = j47();
  }
}
class J48 extends J48Base {}
function j48() {
  return new J48().text;
}
class J49 {
  constructor() {
    this.text = j48();
  }
}
function j49() {
  return new J49().text;
}
function J50() {
  return { text: j49() };
}
function j50() {
  return new J50().text;
}
class J51 {
  constructor() {
    this.text = j50();
  }
}
function j51() {
  return new J51().text;
}
function j52Holder() {
  return { text: j51() };
}
function J52() {
  return j52Holder();
}
function j52() {
  return new J52().text;
}
function j53Holder() {
  return { text: j52() };
}
function J53() {
  this.level = 53;
  return j53Holder();
}
function j53() {
  return (made & 1 ? new J53() : J53.call({})).text;
}
class J54 {
  constructor() {
    this.text = j53();
  }
}
function j54() {
  return new J54().text;
}
class J55Base {
  constructor() {
    this.text = j54();
  }
}
class J55 extends J55Base {}
function j55() {
  return new J55().text;
}
class J56 {
  constructor() {
    this.text = j55();
  }
}
function j56() {
  return new J56().text;
}
function J57() {
  return { text: j56() };
}
function j57() {
  return new J57().text;
}
class J58 {
  constructor() {
    this.text = j57();
  }
}
function j58() {
  return new J58().text;
}
function j59Holder() {
  return { text: j58() };
}
function J59() {
  return j59Holder();
}
function j59() {
  return new J59().text;
}
function j60Holder() {
  return { text: j59() };
}
function J60() {
  this.level = 60;
  return j60Holder();
}
function j60() {
  return (made & 1 ? new J60() : J60.call({})).text;
}
class J61 {
  constructor() {
    this.text = j60();
  }
}
function j61() {
  return new J61().text;
}
class J62Base {
  constructor() {
    this.text = j61();
  }
}
class J62 extends J62Base {}
function j62() {
  return new J62().text;
}
class J63 {
  constructor() {
    this.text = j62();
  }
}
function j63() {
  return new J63().text;
}
function J64() {
  return { text: j63() };
}
function j64() {
  return new J64().text;
}
class J65 {
  constructor() {
    this.text = j64();
  }
}
function j65() {
  return new J65().text;
}
function j66Holder() {
  return { text: j65() };
}
function J66() {
  return j66Holder();
}
function j66() {
  return new J66().text;
}
function j67Holder() {
  return { text: j66() };
}
function J67() {
  this.level = 67;
  return j67Holder();
}
function j67() {
  return (made & 1 ? new J67() : J67.call({})).text;
}
class J68 {
  constructor() {
    this.text = j67();
  }
}
function j68() {
  return new J68().text;
}
class J69Base {
  constructor() {
    this.text = j68();
  }
}
class J69 extends J69Base {}
function j69() {
  return new J69().text;
}
class J70 {
  constructor() {
    this.text = j69();
  }
}
function j70() {
  return new J70().text;
}
function J71() {
  return { text: j70() };
}
function j71() {
  return new J71().text;
}
class J72 {
  constructor() {
    this.text = j71();
  }
}
function j72() {
  return new J72().text;
}
function j73Holder() {
  return { text: j72() };
}
function J73() {
  return j73Holder();
}
function j73() {
  return new J73().text;
}
function j74Holder() {
  return { text: j73() };
}
function J74() {
  this.level = 74;
  return j74Holder();
}
function j74() {
  return (made & 1 ? new J74() : J74.call({})).text;
}
class J75 {
  constructor() {
    this.text = j74();
  }
}
function j75() {
  return new J75().text;
}
class J76Base {
  constructor() {
    this.text = j75();
  }
}
class J76 extends J76Base {}
function j76() {
  return new J76().text;
}
class J77 {
  constructor() {
    this.text = j76();
  }
}
function j77() {
  return new J77().text;
}
function J78() {
  return { text: j77() };
}
function j78() {
  return new J78().text;
}
class J79 {
  constructor() {
    this.text = j78();
  }
}
function j79() {
  return new J79().text;
}
function j80Holder() {
  return { text: j79() };
}
function J80() {
  return j80Holder();
}
function j80() {
  return new J80().text;
}
function j81Holder() {
  return { text: j80() };
}
function J81() {
  this.level = 81;
  return j81Holder();
}
function j81() {
  return (made & 1 ? new J81() : J81.call({})).text;
}
class J82 {
  constructor() {
    this.text = j81();
  }
}
function j82() {
  return new J82().text;
}
class J83Base {
  constructor() {
    this.text = j82();
  }
}
class J83 extends J83Base {}
function j83() {
  return new J83().text;
}
class J84 {
  constructor() {
    this.text = j83();
  }
}
function j84() {
  return new J84().text;
}
function J85() {
  return { text: j84() };
}
function j85() {
  return new J85().text;
}
class J86 {
  constructor() {
    this.text = j85();
  }
}
function j86() {
  return new J86().text;
}
function j87Holder() {
  return { text: j86() };
}
function J87() {
  return j87Holder();
}
function j87() {
  return new J87().text;
}
function j88Holder() {
  return { text: j87() };
}
function J88() {
  this.level = 88;
  return j88Holder();
}
function j88() {
  return (made & 1 ? new J88() : J88.call({})).text;
}
class J89 {
  constructor() {
    this.text = j88();
  }
}
function j89() {
  return new J89().text;
}
class J90Base {
  constructor() {
    this.text = j89();
  }
}
class J90 extends J90Base {}
function j90() {
  return new J90().text;
}
class J91 {
  constructor() {
    this.text = j90();
  }
}
function j91() {
  return new J91().text;
}
function J92() {
  return { text: j91() };
}
function j92() {
  return new J92().text;
}
class J93 {
  constructor() {
    this.text = j92();
  }
}
function j93() {
  return new J93().text;
}
function j94Holder() {
  return { text: j93() };
}
function J94() {
  return j94Holder();
}
function j94() {
  return new J94().text;
}
function j95Holder() {
  return { text: j94() };
}
function J95() {
  this.level = 95;
  return j95Holder();
}
function j95() {
  return (made & 1 ? new J95() : J95.call({})).text;
}
class J96 {
  constructor() {
    this.text = j95();
  }
}
function j96() {
  return new J96().text;
}
class J97Base {
  constructor() {
    this.text = j96();
  }
}
class J97 extends J97Base {}
function j97() {
  return new J97().text;
}
class J98 {
  constructor() {
    this.text = j97();
  }
}
function j98() {
  return new J98().text;
}
function J99() {
  return { text: j98() };
}
function j99() {
  return new J99().text;
}
class J100 {
  constructor() {
    this.text = j99();
  }
}
function j100() {
  return new J100().text;
}
for (const chain of [a100, b100, c100, d100, e100, f100, g100, h100, i100, j100]) {
  console.log(chain());
  console.log(chain());
}
