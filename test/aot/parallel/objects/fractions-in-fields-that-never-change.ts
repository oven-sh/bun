// A field that holds one fraction for good is read as that number. Each object here has names of its own, so each has a layout of its own:
// whatever changes a field, hides it or may leave it out has to keep the read by itself.
let sink: unknown;
const kept = { keptRate: 0.2, keptBase: 0.05 };
function ofKept(amount: number): number {
  return amount * kept.keptRate + kept.keptBase;
}

const special = { nan: NaN, minusZero: -0, huge: 1e300, tiny: 5e-324, infinite: -Infinity, big: 9007199254740993 };
function specials(): string {
  return [
    special.nan,
    Object.is(special.minusZero, -0),
    1 / special.minusZero,
    special.huge,
    special.tiny,
    special.infinite,
    special.big,
  ].join(" ");
}

const written = { writtenRate: 0.2 };
function ofWritten(): number {
  return written.writtenRate;
}

const added = { addedRate: 0.2 };
function ofAdded(): number {
  return added.addedRate;
}

const byKey: { [key: string]: number } = { byKeyRate: 0.2 };
function ofByKey(): number {
  return byKey.byKeyRate;
}

const escaped = { escapedRate: 0.2 };
function ofEscaped(): number {
  return escaped.escapedRate;
}

const assigned = { assignedRate: 0.2 };
function ofAssigned(): number {
  return assigned.assignedRate;
}

const reflected = { reflectedRate: 0.2 };
function ofReflected(): number {
  return reflected.reflectedRate;
}

const redefined = { redefinedRate: 0.2 };
function ofRedefined(): number {
  return redefined.redefinedRate;
}

const madeGetter = { getterRate: 0.2 };
function ofMadeGetter(): number {
  return madeGetter.getterRate;
}

const deleted: { deletedRate?: number } = { deletedRate: 0.2 };
function ofDeleted(): unknown {
  return deleted.deletedRate;
}

const frozen = Object.freeze({ frozenRate: 0.2 });
function ofFrozen(): number {
  return frozen.frozenRate;
}

const one = { eitherRate: 0.25 },
  other = { eitherRate: 0.75 };
function either(which: boolean): number {
  return (which ? one : other).eitherRate;
}

const twin1 = { twinRate: 0.5 },
  twin2 = { twinRate: 0.5 };
function twin(which: boolean): number {
  return (which ? twin1 : twin2).twinRate;
}

const maybe: { maybeRate: number } | null = process.argv.length > 100 ? null : { maybeRate: 0.125 };
function ofNothing(holder: { maybeRate: number } | null): unknown {
  try {
    return holder!.maybeRate;
  } catch (error) {
    return (error as Error).name;
  }
}

let replaced = { replacedRate: 0.2 };
function ofReplaced(): number {
  return replaced.replacedRate;
}

const nested = { inner: { nestedRate: 0.2 } };
function ofNested(): number {
  return nested.inner.nestedRate;
}

function make(rate: number): { madeRate: number } {
  return { madeRate: rate };
}
const made1 = make(0.2),
  made2 = make(0.4);
function ofMade(which: boolean): number {
  return (which ? made1 : made2).madeRate;
}

const early = {
  get earlyRate(): number {
    return late.lateRate;
  },
};
function ofEarly(): unknown {
  try {
    return early.earlyRate;
  } catch (error) {
    return (error as Error).name;
  }
}
const beforeLate = ofEarly();
const late = { lateRate: 0.2 };

const spreadFrom = { spreadRate: 0.2 };
const spreadInto = { ...spreadFrom, spreadRate: 0.6 };
function ofSpread(): number {
  return spreadFrom.spreadRate + spreadInto.spreadRate;
}

sink = [
  ofKept,
  specials,
  ofWritten,
  ofAdded,
  ofByKey,
  ofEscaped,
  ofAssigned,
  ofReflected,
  ofRedefined,
  ofMadeGetter,
  ofDeleted,
  ofFrozen,
  either,
  twin,
  ofNothing,
  ofReplaced,
  ofNested,
  ofMade,
  ofEarly,
  ofSpread,
];
function show(when: string) {
  console.log(when, ofKept(10), specials());
  console.log(
    when,
    ofWritten(),
    ofAdded(),
    ofByKey(),
    ofEscaped(),
    ofAssigned(),
    ofReflected(),
    ofRedefined(),
    ofMadeGetter(),
    ofDeleted(),
    ofFrozen(),
  );
  console.log(
    when,
    either(true),
    either(false),
    twin(true),
    twin(false),
    ofNothing(null),
    ofNothing(maybe),
    ofReplaced(),
    ofNested(),
    ofMade(true),
    ofMade(false),
    beforeLate,
    ofEarly(),
    ofSpread(),
  );
}
show("at first");
written.writtenRate = 0.4;
added.addedRate += 0.25;
byKey[process.argv.length > 100 ? "other" : "byKeyRate"] = 0.4;
(globalThis as any).escaped = escaped;
new Function("escaped.escapedRate = 0.4")();
Object.assign(assigned, { assignedRate: 0.4 });
Reflect.set(reflected, "reflectedRate", 0.4);
Object.defineProperty(redefined, "redefinedRate", { value: 0.4 });
Object.defineProperty(madeGetter, "getterRate", { get: () => 0.4 });
delete deleted.deletedRate;
try {
  (frozen as any).frozenRate = 0.4;
} catch {}
replaced = { replacedRate: 0.4 };
nested.inner = { nestedRate: 0.4 };
show("afterwards");
console.log(typeof sink);
