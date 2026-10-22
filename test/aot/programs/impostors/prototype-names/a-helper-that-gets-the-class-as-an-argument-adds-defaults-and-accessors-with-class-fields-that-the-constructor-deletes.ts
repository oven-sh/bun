// Helpers written like decorators get a class as an argument and change its prototype: one copies defaults, one makes a field observed.
// One class is treated before it has instances, the other after 3000 of them.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
type AnyClass = new (...args: any[]) => object;
const log: string[] = [];
function withDefaults<C extends AnyClass>(target: C, defaults: Record<string, unknown>): C {
  for (const key of Object.keys(defaults)) target.prototype[key] = defaults[key];
  return target;
}
function observed<C extends AnyClass>(target: C, key: string): C {
  const values = new WeakMap<object, unknown>();
  Object.defineProperty(target.prototype, key, {
    get() {
      return values.get(this);
    },
    set(value) {
      log.push(`${key} = ${value}`);
      values.set(this, value);
    },
    configurable: true,
  });
  return target;
}

class Early {
  declare id: number;
  retries?: number;
  state?: string;
  constructor(id: number) {
    delete this.retries;
    delete this.state;
    handOver(this);
    this.id = id;
  }
}
class Late {
  declare id: number;
  retries?: number;
  state?: string;
  constructor(id: number) {
    delete this.retries;
    delete this.state;
    handOver(this);
    this.id = id;
  }
}
function lookEarly(object: Early) {
  return `${object.retries} ${object.state} [${Object.keys(object)}]`;
}
function lookLate(object: Late) {
  return `${object.retries} ${object.state} [${Object.keys(object)}]`;
}
function runEarly(object: Early, n: number) {
  object.retries = (object.retries ?? 0) + n;
  object.state = "s" + n;
}
function runLate(object: Late, n: number) {
  object.retries = (object.retries ?? 0) + n;
  object.state = "s" + n;
}

observed(withDefaults(Early, { retries: 3 }), "state");
const early = new Early(1);
console.log("treated first:", lookEarly(early));
runEarly(early, 1);
console.log("run:", lookEarly(early), log.join(", "));
log.length = 0;

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const late = new Late(i);
  sum += lookLate(late).length;
  if (i & 1) runLate(late, i & 3);
  sum += late.retries ?? 0;
}
console.log("warm", sum, log.length);
const empty = new Late(1);
const filled = new Late(2);
runLate(filled, 2);
observed(withDefaults(Late, { retries: 3 }), "state");
const fresh = new Late(3);
console.log("treated late:", lookLate(empty), "|", lookLate(filled), "|", lookLate(fresh));
runLate(empty, 1);
runLate(filled, 1);
runLate(fresh, 1);
console.log("run:", lookLate(empty), "|", lookLate(filled), "|", lookLate(fresh), "|", log.join(", "));
