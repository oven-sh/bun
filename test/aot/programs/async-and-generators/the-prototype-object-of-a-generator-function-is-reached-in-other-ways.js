// The prototype object of a generator function is no generator, by whatever way the program gets hold of it: `next` called on it throws a TypeError.
function* numbers() { yield 2; }
async function* later() { yield 3; }
function attempt(name, run) {
  try { console.log(name, run()); } catch (error) { console.log(name, error instanceof TypeError); }
}
attempt("above a generator", () => Object.getPrototypeOf(numbers()).next());
attempt("reflect above a generator", () => Reflect.getPrototypeOf(numbers()).next());
attempt("__proto__", () => numbers().__proto__.next());
attempt("reflect get", () => Reflect.get(numbers, "prototype").next());
attempt("destructured", () => { const { prototype } = numbers; return prototype.next(); });
attempt("computed", () => numbers[["proto", "type"].join("")].next());
attempt("return", () => numbers.prototype.return(1));
attempt("throw", () => numbers.prototype.throw(1));
attempt("spread", () => [...numbers.prototype]);
attempt("for of", () => { for (const each of numbers.prototype) return each; });
numbers.prototype.twice = function () { return this.next().value * 2; };
attempt("a method stored there", () => numbers().twice());
attempt("a generator", () => numbers().next().value);
try { console.log("async", await later.prototype.next()); } catch (error) { console.log("async", error instanceof TypeError); }
try { console.log("async above", await Object.getPrototypeOf(later()).next()); } catch (error) { console.log("async above", error instanceof TypeError); }
console.log("async generator", (await later().next()).value);
