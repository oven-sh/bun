// Sloppy code: the same stores are refused in silence, and what was made does not have the property.
function asyncConstructor() { const made = async function () {}; made.constructor = 2; return made; }
function generatorConstructor() { const made = function* () {}; made.constructor = 2; return made; }
function plainConstructor() { const made = function () {}; made.constructor = 2; return made; }
function plainHasInstance() { const made = function () {}; made[Symbol.hasInstance] = 2; return made; }
function once() {
  const a = asyncConstructor(), g = generatorConstructor(), p = plainConstructor(), h = plainHasInstance();
  console.log("behind the calls");
  return () => [Object.hasOwn(a, "constructor"), Object.hasOwn(g, "constructor"), Object.hasOwn(p, "constructor"), Object.hasOwn(h, Symbol.hasInstance), typeof a.constructor, typeof g.constructor, typeof p.constructor];
}
console.log(once()().join(" "));
