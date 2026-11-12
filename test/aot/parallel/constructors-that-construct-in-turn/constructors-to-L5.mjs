function L0() { this.v = 1; }
function L1() { this.v = new L0().v + new L0().v + new L0().v + new L0().v + new L0().v + new L0().v + new L0().v + new L0().v; }
function L2() { this.v = new L1().v + new L1().v + new L1().v + new L1().v + new L1().v + new L1().v + new L1().v + new L1().v; }
function L3() { this.v = new L2().v + new L2().v + new L2().v + new L2().v + new L2().v + new L2().v + new L2().v + new L2().v; }
function L4() { this.v = new L3().v + new L3().v + new L3().v + new L3().v + new L3().v + new L3().v + new L3().v + new L3().v; }
function L5() { this.v = new L4().v + new L4().v + new L4().v + new L4().v + new L4().v + new L4().v + new L4().v + new L4().v; }
console.log(new L5().v);
