"use strict";
const out = [];
let heard = 0;
const registry = new FinalizationRegistry(() => { heard++; });
(function () {
  var felt = { rows: new Array(2000).fill(1) };
  function Hat(n) { this.n = n + felt.rows.length; }
  Hat.prototype.name = function () { return "hat:" + this.n + felt.rows[0]; };
  registry.register(Hat, "class");
  registry.register(Hat.prototype, "prototype");
  out.push(new Hat(1).name());
})();
let rounds = 0;
(function wait() {
  Bun.gc(true);
  if (heard < 2 && ++rounds < 40) return void setTimeout(wait, 5);
  console.log(out.join(), heard);
})();
