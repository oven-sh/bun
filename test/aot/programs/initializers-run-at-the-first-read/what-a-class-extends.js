// What a class extends decides whether its definition throws and what it reads.
const log = [];
let A; try { A = class extends Math.max {}; } catch (error) { log.push("Math.max " + error.name); }
let B; try { B = class extends Symbol.iterator {}; } catch (error) { log.push("symbol " + error.name); }
let C; try { C = class extends (() => {}) {}; } catch (error) { log.push("arrow " + error.name); }
function Plain() {}
Plain.prototype = 5;
let D; try { D = class extends Plain {}; } catch (error) { log.push("prototype 5 " + error.name); }
function Later() {}
class E extends Later {}
Later.prototype = { changed: true };
class F extends Later {}
const G = class extends Array {};
const H = class extends null {};
class Base { static s = log.push("static of Base"); }
class Derived extends Base { static t = log.push("static of Derived"); }
log.push("after the classes");
const proxied = new Proxy(function () {}, { get(target, key) { log.push("get " + String(key)); return target[key]; } });
class I extends proxied {}
log.push("after I");
log.push([typeof A, typeof B, typeof C, typeof D, new E().changed, new F().changed, new G(3).length, Object.getPrototypeOf(H.prototype), Derived.t, typeof I].join());
console.log(log.join("\n"));
