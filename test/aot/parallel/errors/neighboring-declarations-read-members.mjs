// Bun's transpiler prints neighboring declarations that read members of one name as one pattern, `const { x, y } = o`: each line has the words and the places of what is thrown there.
const frames = error => error.stack.split("\n").slice(1, 3).map(line => line.replace(/^.*?([a-zA-Z<>.]+) \(.*:(\d+:\d+)\)$/, "$1@$2").replace(/^.*:(\d+:\d+)$/, "@$1")).join(" ");
const show = (f, ...a) => { try { console.log(f.name, JSON.stringify(f(...a))); } catch (error) { console.log(f.name, error.name, error.message.replace(/ \(evaluating .*\)$/, ""), frames(error)); } };
function two(o) { const x = o.x; const y = o.y; return [x, y]; }
function twoLets(o) { let x = o.x; let y = o.y; return [x, y]; }
function twoVars(o) { var x = o.x; var y = o.y; return [x, y]; }
function oneStatement(o) { const x = o.x, y = o.y; return [x, y]; }
function three(o) { const x = o.x; const y = o.y; const z = o.z; return [x, y, z]; }
function renamed(o) { const a = o.x; const b = o.y; return [a, b]; }
function lines(o) {
  const x = o.x;
  const y = o.y;
  return [x, y];
}
function mixedKinds(o) { const x = o.x; let y = o.y; return [x, y]; }
function between(o) { const x = o.x; show.length; const y = o.y; return [x, y]; }
function otherFirst(o) { const n = 1; const x = o.x; const y = o.y; return [n, x, y]; }
function otherBetween(o) { const x = o.x, n = 1, y = o.y; return [n, x, y]; }
function twoObjects(o, p) { const x = o.x; const y = p.y; return [x, y]; }
function twoRuns(o, p) { const x = o.x; const y = o.y; const a = p.x; const b = p.y; return [x, y, a, b]; }
function assigned(o) { const x = o.x; const y = o.y; o = 1; return [x, y]; }
function chain(o) { const x = o?.x; const y = o.y; return [x, y]; }
function chainSecond(o) { const x = o.x; const y = o?.y; return [x, y]; }
function bracket(o) { const x = o["x"]; const y = o["y"]; return [x, y]; }
function computed(o, k) { const x = o[k]; const y = o.y; return [x, y]; }
function deep(o) { const x = o.a.x; const y = o.a.y; return [x, y]; }
function rebinds(o) { var x = o.x; var o = o.y; return [x, o]; }
function thisObject() { const x = this.x; const y = this.y; return [x, y]; }
function unused(o) { const x = o.x; const y = o.y; return 1; }
function usedOnce(o) { const x = o.x; const y = o.y; return x; }
function inLoop(o) { for (let x = o.x, y = o.y; ; ) return [x, y]; }
function inBlock(o) { { const x = o.x; const y = o.y; return [x, y]; } }
function captured(o) { const x = o.x; const y = o.y; return [() => o, x, y].length; }
function globalObject() { const a = Math.PI; const b = Math.E; return [a > 3, b > 2]; }
function unknownGlobal() { const a = nowhere.x; const b = nowhere.y; return [a, b]; }
function getterThrows(o) { const x = o.x; const y = o.bad; return [x, y]; }
function firstGetterThrows(o) { const x = o.bad; const y = o.y; return [x, y]; }
const arrow = o => { const x = o.x; const y = o.y; return [x, y]; };
async function asynchronous(o) { const x = o.x; const y = o.y; return [x, y]; }
function* generator(o) { const x = o.x; const y = o.y; yield [x, y]; }
const moduleObject = null;
function ofModule() { const x = moduleObject.x; const y = moduleObject.y; return [x, y]; }
for (const f of [two, twoLets, twoVars, oneStatement, three, renamed, lines, mixedKinds, between, otherFirst, otherBetween, assigned, chain, chainSecond, bracket, deep, rebinds, unused, usedOnce, inLoop, inBlock, captured, arrow]) {
  show(f, null); show(f, undefined); show(f, { x: 1, y: 2, z: 3, a: { x: 4, y: 5 } }); show(f, 5);
}
show(twoObjects, null, {}); show(twoObjects, {}, null); show(twoRuns, {}, null); show(twoRuns, null, {}); show(computed, null, "x");
show(thisObject); show(globalObject); show(unknownGlobal); show(ofModule);
show(getterThrows, { x: 1, get bad() { throw new Error("getter"); } });
show(firstGetterThrows, { y: 1, get bad() { throw new Error("getter"); } });
await asynchronous(null).catch(error => console.log("asynchronous", error.message, frames(error)));
try { generator(null).next(); } catch (error) { console.log("generator", error.message, frames(error)); }
function thirdGetterThrows(o) { const x = o.x; const y = o.y; const z = o.bad; return [x, y, z]; }
function thirdOnLines(o) {
  const x = o.x;
  const y = o.y;
  const z = o.bad;
  return [x, y, z];
}
function firstOnLines(o) {
  const x = o.bad;
  const y = o.y;
  const z = o.z;
  return [x, y, z];
}
const bad = () => ({ x: 1, y: 2, z: 3, get bad() { throw new Error("getter"); } });
show(thirdGetterThrows, bad()); show(thirdOnLines, bad()); show(firstOnLines, bad());
show(thirdOnLines, new Proxy({}, { get(target, key) { if (key === "y") throw new Error("trap"); return 1; } }));
