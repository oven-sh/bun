// `static readonly Low = 10` has the type 10. A class whose static fields nobody touches again, and classes whose fields are stored, defined, deleted or frozen behind the checker's back: every read sees what is there.
const lines: string[] = [];
function say(label: string, value: unknown): void {
  lines.push(label + ": " + String(value));
}

class Untouched {
  static readonly Low = 10;
  static readonly High = 200;
  static readonly Below = -3;
  static readonly Half = 0.5;
  static readonly Big = 4294967296;
  static readonly Name = "limits";
}
function clamp(value: number): number {
  return value < Untouched.Low ? Untouched.Low : value > Untouched.High ? Untouched.High : value;
}

class StoredByACast {
  static readonly Low = 10;
}
function readStored(): number {
  return StoredByACast.Low + 1;
}

class StoredAnotherKind {
  static readonly Low = 10;
}
function readOtherKind(): string {
  return typeof StoredAnotherKind.Low + " " + StoredAnotherKind.Low;
}

class Defined {
  static readonly Low = 10;
}
function readDefined(): number {
  return Defined.Low * 2;
}

class Deleted {
  static readonly Low = 10;
}
function readDeleted(): string {
  return String(Deleted.Low) + " " + ("Low" in Deleted);
}

class StoredByKey {
  static readonly Low = 10;
  static readonly High = 20;
}
function readByKey(): number {
  return StoredByKey.Low + StoredByKey.High;
}

class Counted {
  static count: 0 | 1 | 2 = 0;
}
function bump(): number {
  Counted.count = ((Counted.count + 1) % 3) as 0 | 1 | 2;
  return Counted.count;
}

class Above {
  static readonly Low = 10;
}
class Below extends Above {}
function readBelow(): number {
  return Below.Low + Above.Low;
}

class InitializedByACall {
  static readonly Low: 10 = pick() as 10;
}
function pick(): number {
  return lines.length === 0 ? 10 : 11;
}
function readInitialized(): number {
  return InitializedByACall.Low;
}

function all(): string {
  let sum = 0;
  for (let i = 0; i < 300; i += 7) sum += clamp(i);
  return [sum, Untouched.Below, Untouched.Half, Untouched.Big, Untouched.Name, readStored(), readOtherKind(), readDefined(), readDeleted(), readByKey(), bump(), readBelow(), readInitialized()].join(" | ");
}

let last = "";
for (let turn = 0; turn < 50; turn++) last = all();
say("before", last);

(StoredByACast as { Low: number }).Low = 11;
say("stored by a cast", all());
(StoredAnotherKind as unknown as { Low: string }).Low = "ten";
say("another kind stored", all());
Object.defineProperty(Defined, "Low", { get: () => 21, configurable: true });
say("defined as a getter", all());
delete (Deleted as { Low?: number }).Low;
say("deleted", all());
for (const key of ["Low", "High"]) (StoredByKey as unknown as Record<string, number>)[key] = key.length;
say("stored by key", all());
(Below as unknown as { Low: number }).Low = 1;
say("hidden below", all());
Object.assign(Above, { Low: 5 });
say("assigned above", all());
Object.freeze(Counted);
say("frozen", (() => {
  try {
    return all();
  } catch (error) {
    return (error as Error).constructor.name;
  }
})());
console.log(lines.join("\n"));
