(0, eval)("0"); // One evaluation anywhere, and unseen code may run in the whole build.
class Low {}
class Mid extends Low {}
class Top extends Mid {
  probe() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return super.__proto__; }
  static probe() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return super.__proto__; }
}
function tell(t) { let out = ""; for (let i = 0; i < 300; i++) out = [t.probe() === Top.prototype, t.probe() === Low.prototype, Top.probe() === Mid, Top.probe() === Low].join(); return out; }
console.log(tell(new Top()));
