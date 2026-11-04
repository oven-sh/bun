// RUN: lower
// OPTIONS: builtin-modules

// node:events stores properties on objects that a program hands it: EventEmitter.call(object) and on() ADD _events, _eventsCount and _maxListeners where they are absent. Each case first runs the same stores many times on one shape, then changes what the next store must obey: an object that may not be extended, is sealed or frozen; a setter or a read-only property of that name that appears up the chain, and goes again; a property that is there already; many shapes by turns; shapes that die and are collected between the runs.
import { EventEmitter } from "node:events";

const lines: string[] = [];
const warm = 300;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const names = ["_events", "_eventsCount", "_maxListeners"];
function made(object: any): string {
  let threw = "";
  try {
    EventEmitter.call(object);
  } catch (error) {
    threw = " threw " + (error as Error).constructor.name;
  }
  return names.map(name => (Object.hasOwn(object, name) ? typeof object[name] : "-")).join() + " keys " + Object.keys(object).join() + threw;
}
function Plain(this: any, tag: number) {
  this.tag = tag;
}
Plain.prototype = Object.create(EventEmitter.prototype);
const fresh = (tag = 0): any => new (Plain as any)(tag);

for (let i = 0; i < warm; i++) made(fresh(i));
lines.push("fresh: " + made(fresh()));
lines.push("twice: " + (() => { const object = fresh(); made(object); return made(object); })());
lines.push("not extensible: " + made(Object.preventExtensions(fresh())));
lines.push("sealed: " + made(Object.seal(fresh())));
lines.push("frozen: " + made(Object.freeze(fresh())));
lines.push("fresh again: " + made(fresh()));
{
  const object = fresh();
  object._eventsCount = 7;
  lines.push("one is there already: " + made(object) + " " + object._eventsCount);
}
{
  const object = fresh();
  Object.defineProperty(object, "_maxListeners", { value: 3, writable: false, configurable: true, enumerable: true });
  lines.push("one is there and read-only: " + made(object) + " " + object._maxListeners);
}

{
  const seen: unknown[] = [];
  Object.defineProperty(Plain.prototype, "_eventsCount", { configurable: true, get: () => 42, set: value => void seen.push(value) });
  const object = fresh();
  lines.push("a setter on the class: " + made(object) + " seen " + seen.join() + " reads " + object._eventsCount);
  delete Plain.prototype._eventsCount;
  lines.push("the setter gone: " + made(fresh()) + " seen " + seen.length);
}
{
  Object.defineProperty(Plain.prototype, "_maxListeners", { configurable: true, value: 5, writable: false });
  const object = fresh();
  lines.push("read-only on the class: " + made(object) + " reads " + object._maxListeners);
  delete Plain.prototype._maxListeners;
  lines.push("gone: " + made(fresh()));
}
{
  const between = Object.create(EventEmitter.prototype);
  const seen: unknown[] = [];
  Object.defineProperty(between, "_events", { configurable: true, get: () => undefined, set: value => void seen.push(typeof value) });
  Object.setPrototypeOf(Plain.prototype, between);
  lines.push("a prototype between with a setter: " + made(fresh()) + " seen " + seen.join());
  Object.setPrototypeOf(Plain.prototype, EventEmitter.prototype);
  lines.push("taken out: " + made(fresh()) + " seen " + seen.length);
}

{
  const makers: (() => any)[] = [];
  for (let i = 0; i < 10; i++) {
    makers.push(() => {
      const object = Object.create(EventEmitter.prototype);
      for (let k = 0; k <= i; k++) object["p" + ((i * 5 + k) % 11)] = k;
      return object;
    });
  }
  let last = "";
  for (let round = 0; round < 40; round++) for (const make of makers) last = made(make());
  lines.push("ten shapes by turns: " + last);
}
{
  let last = "";
  for (let generation = 0; generation < 40; generation++) {
    const prototype = Object.create(EventEmitter.prototype);
    prototype["only" + generation] = generation;
    for (let i = 0; i < 12; i++) {
      const object = Object.create(prototype);
      object["own" + generation] = i;
      last = made(object);
      object.on("x", () => {});
      last += " " + object.listenerCount("x");
    }
    if (generation % 4 === 3) {
      Bun.gc(true);
      await turn();
    }
  }
  lines.push("forty shapes that die: " + last);
}
{
  const wide = fresh();
  for (let i = 0; i < 80; i++) wide["w" + i] = i;
  lines.push("a wide object: " + made(wide).replace(/w\d+,?/g, "").trim());
  const old: any[] = [];
  for (let i = 0; i < 50; i++) old.push(fresh(i));
  Bun.gc(true);
  await turn();
  Bun.gc(true);
  let kept = "";
  for (const object of old) kept = made(object);
  Bun.gc(true);
  lines.push("objects that have been through two collections: " + kept + " " + old.every(object => typeof object._events === "object" && object._eventsCount === 0));
}
console.log(lines.join("\n"));

// GENERATED: made Plain turn fresh
// CHECK-LABEL: function {{*}}name="made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="EventEmitter"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(NodeEventsEventEmitter) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="call"
// CHECK-NEXT: v7 = Call v6, v5, v0 calleeKey="call" calleeName="EventEmitter.call"
// CHECK-NEXT: Jump -> next b3(v2)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string=" threw "
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = PropGet v10 key="constructor"
// CHECK-NEXT: v12 = PropGet v11 key="name"
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b3(v14)
// CHECK-NEXT: b3(v15: undefined|null|string):
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="names"
// CHECK-NEXT: v18 = PropGet v17 key="map"
// CHECK-NEXT: v19 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="map" calleeName="names.map"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<undefined|null|"-"|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v22 = PropGet v21 key="join"
// CHECK-NEXT: v23 = Call v22, v21 calleeKey="join" calleeName="join"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v25 = String string=" keys "
// CHECK-NEXT: v26 = Add v24, v25
// CHECK-NEXT: v27 = Builtin builtin=Object
// CHECK-NEXT: v28 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v29 = Call v28, v27, v0 calleeName="Object.keys"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v31 = PropGet v30 key="join"
// CHECK-NEXT: v32 = Call v31, v30 calleeKey="join" calleeName="join"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v34 = Add v26, v33
// CHECK-NEXT: v35 = Add v34, v15
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_4]]} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_4]], v1: number):
// CHECK-NEXT: PropSet v0, v1 key="tag"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="turn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Promise" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_5]]
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Promise"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fresh"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} parameters=[{type=undefined|number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|number):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v8 = Construct v7, -, v6 calleeName="Plain"
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
