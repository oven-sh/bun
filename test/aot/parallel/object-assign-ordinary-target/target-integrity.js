// A target that is not extensible, sealed or frozen refuses new keys, also after earlier calls on extensible targets of the same shape.
"use strict";
const proto = { kind: "p" };
function run(label, prepare) {
  const target = Object.create(proto);
  prepare(target);
  try {
    console.log(label, JSON.stringify(Object.assign(target, { alpha: 1, beta: 2 })));
  } catch (error) {
    console.log(label, error.name, JSON.stringify(target));
  }
}
for (let round = 0; round < 4; round++) {
  run("plain", () => {});
  run("not extensible", target => Object.preventExtensions(target));
  run("sealed", target => Object.seal(target));
  run("frozen", target => Object.freeze(target));
  run("frozen with alpha", target => { target.alpha = 0; Object.freeze(target); });
  run("sealed with both", target => { target.alpha = 0; target.beta = 0; Object.seal(target); });
}
