function L0() { this.v = 1; }
function L1() { this.v = new L0().v + new L0().v + new L0().v + new L0().v + new L0().v + new L0().v + new L0().v + new L0().v; }
function L2() { this.v = new L1().v + new L1().v + new L1().v + new L1().v + new L1().v + new L1().v + new L1().v + new L1().v; }
function L3() { this.v = new L2().v + new L2().v + new L2().v + new L2().v + new L2().v + new L2().v + new L2().v + new L2().v; }
console.log(new L3().v);
