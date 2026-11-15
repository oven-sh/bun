// While a loop over a generator runs, its return is laid round the engine's own, or a proxy or a getter above answers the engine's own.
const notes = [];
const pick = name => notes.length < 0 ? "" : name;
function* plainly(limit) { for (let i = 0; i < limit; i++) yield i; }
function* finally_(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { notes.push("finally"); } }
const first = plainly.prototype, second = finally_.prototype, above = Object.getPrototypeOf(first), engines = above.return;
const made = [plainly(1), finally_(1), plainly(2), finally_(2)].map(each => each.next().value);
console.log(made.join());
function wrap() { first[pick("return")] = function (value) { notes.push("wrapped"); const answer = engines.call(this, value); notes.push(answer.done); return answer; }; }
function drain(it) { let n = 0; for (const v of it) { wrap(); if (++n === 2) break; } return n; }
const proxied = (holder, name) => Object.setPrototypeOf(holder, new Proxy(above, { get(target, key, receiver) { notes.push(name, String(key)); return Reflect.get(target, key, receiver); } }));
const ways = {
  wrapped() { let n = 0; for (const v of plainly(3)) { wrap(); if (++n === 2) break; } return n; },
  passed() { return drain(plainly(3)) + drain(plainly(4)); },
  thrown() { let n = 0; for (const v of plainly(3)) { first[pick("return")] = function (value) { notes.push("thrown into"); return this.throw(new Error("mine")); }; if (++n === 2) return n; } return -1; },
  proxy() { let n = 0; for (const v of plainly(3)) { proxied(first, "proxy"); if (++n === 2) break; } return n; },
  proxyOfFinally() { let n = 0; for (const v of finally_(3)) { proxied(second, "proxy"); if (++n === 2) break; } return n; },
  getterOfFinally() { let n = 0; for (const v of finally_(3)) { Object.defineProperty(second, pick("return"), { configurable: true, get() { notes.push("get"); return engines; } }); if (++n === 2) throw new Error("out"); } return n; },
  enginesOwn() { let n = 0; for (const v of finally_(3)) { second[pick("return")] = engines; if (++n === 2) return n; } return -1; },
  getterThrows() { let n = 0; for (const v of plainly(3)) { Object.defineProperty(first, pick("return"), { configurable: true, get() { throw new Error("get"); } }); if (++n === 2) break; } return n; },
  getterThrowsInThrow() { let n = 0; for (const v of plainly(3)) { Object.defineProperty(first, pick("return"), { configurable: true, get() { throw new Error("get"); } }); if (++n === 2) throw new Error("out"); } return n; },
};
for (let turn = 0; turn < 3; turn++) {
  for (const [name, run] of Object.entries(ways)) {
    let answer;
    try { answer = run(); } catch (error) { answer = error.message; }
    console.log(name, answer, notes.join());
    notes.length = 0;
    delete first[pick("return")];
    delete second[pick("return")];
    Object.setPrototypeOf(first, above);
    Object.setPrototypeOf(second, above);
    plainly(1).next();
    finally_(1).next();
  }
}
