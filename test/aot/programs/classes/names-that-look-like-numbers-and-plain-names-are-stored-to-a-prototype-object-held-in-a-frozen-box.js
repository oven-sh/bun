class Base {}
class A extends Base { m() { return 1; } }
const box = Object.freeze({ held: A.prototype });
box.held.extra = 4; box.held["other" + ""] = 5; box.held[1.5] = 6; box.held["01"] = 7; box.held[-1] = 8;
const a = new A();
console.log("instance", a.extra, a.other, a[1.5], a["01"], a[-1], a["-1"], Object.keys(A.prototype).join());
