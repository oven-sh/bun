// Each of these initializers reads something that changes later: a variable, a property, a list, a map, a global. So each holds what it found where its constant is declared.
import * as other from "./other";
import { moving, shared, change } from "./other";
let step = 1;
let maybe: object | null = null;
function readStep(): number { return step; }
function addStep(from: number[]): number[] { const out: number[] = []; for (const x of from) out.push(x + step); return out; }
function withStep(v: number = step): { v: number } { return { v }; }
class WithStep { v = step; }
class Counter { static count = 1; }
const changing = { a: 1, b: 2 };
const growing: Record<string, number> = { a: 1 };
const list = [1, 2];
const holder = { inner: { a: 1 } };
const frozen = Object.freeze({ inner: { a: 1 } });
function aOf(it: { a: number }): number { return it.a; }
function takeA({ a }: { a: number }): { v: number } { return { v: a }; }
const table = new Map<string, number>([["k", 1]]);
const frozenLater = { a: 1 };
function counted(): void {}
(counted as unknown as { calls: number }).calls = 1;
const tools = { name(): string { return "early"; } };
const withRest = { rest: [1] };
const withPattern = { a: 1 };
const withLoopHead = { a: 1 };
const withAlias = { a: 1 };
const withParameter = { a: 1 };
const withDelete: { a?: number; b: number } = { a: 1, b: 2 };
const withDefine = { a: 1 };
function store(into: { a: number }): void { into.a = 9; }

const aLet = { v: step };
const aLetInAFunction = { v: readStep() };
const aLetInAGetterThatIsSpread = { ...{ get v(): number { return step; } } };
const aLetInACallback = [1].map(x => x + step);
const aLetInALoop = addStep([1]);
const aLetInADefault = withStep();
const aLetInAKey = { ["k" + step]: 1 };
const aLetInATemplate = { v: `${step}` };
const aLetInATest = { v: step > 5 ? "late" : "early" };
const aLetThatIsNilOrNot = { v: maybe ? "late" : "early" };
const aLetInAFieldInitializer = new WithStep();
const aLetOfAnotherModule = { v: moving };
const aLetBehindANamespace = { v: other.moving };
const aNamespaceWithALet = { ...other };
const aStaticField = { v: Counter.count };
const aProperty = { v: changing.a };
const aSpread = { ...changing };
const anAssign = Object.assign({}, changing);
const theKeys = Object.keys(growing);
const theValues = Object.values(growing);
const theEntries = Object.entries(growing);
const theDescriptors = Object.defineProperties({}, Object.getOwnPropertyDescriptors(changing));
const aSpreadOfAList = [...list];
const aMapOverAList = list.map(x => x);
const aSliceOfAList = list.slice();
const theLengthOfAList = { v: list.length };
const aSetOfAList = new Set(list);
const aJoinOfAList = { v: list.join() };
const aPropertyOfWhatAConstantHolds = { v: holder.inner.a };
const aPropertyOfWhatAFrozenConstantHolds = { v: frozen.inner.a };
const aPropertyThroughAHelper = { v: aOf(changing) };
const aPropertyThroughAPattern = takeA(changing);
const aMapEntry = { v: table.get("k") };
const theSizeOfAMap = { v: table.size };
const whetherItIsFrozen = { v: Object.isFrozen(frozenLater) };
const aPropertyOfAFunction = { v: (counted as unknown as { calls: number }).calls };
const aMethodThatIsReplaced = { v: tools.name() };
const aGlobal = { v: (globalThis as unknown as { marker?: string }).marker ?? "none" };
const aPropertyStoredToThroughARestElement = { ...withRest };
const aPropertyStoredToThroughAPattern = { ...withPattern };
const aPropertyStoredToInALoopHead = { ...withLoopHead };
const aPropertyStoredToThroughAnAlias = { ...withAlias };
const aPropertyStoredToThroughAParameter = { ...withParameter };
const aPropertyThatIsDeleted = { ...withDelete };
const aPropertyThatIsDefinedAgain = { ...withDefine };
const aPropertyStoredToByAnotherModule = { ...shared };
function show(value: unknown): string { return JSON.stringify(value, (key, held) => (held instanceof Set || held instanceof Map ? [...held] : held)); }
function readAll(): Array<[string, unknown]> { return [["aLet", aLet], ["aLetInAFunction", aLetInAFunction], ["aLetInAGetterThatIsSpread", aLetInAGetterThatIsSpread], ["aLetInACallback", aLetInACallback], ["aLetInALoop", aLetInALoop], ["aLetInADefault", aLetInADefault], ["aLetInAKey", aLetInAKey], ["aLetInATemplate", aLetInATemplate], ["aLetInATest", aLetInATest], ["aLetThatIsNilOrNot", aLetThatIsNilOrNot], ["aLetInAFieldInitializer", aLetInAFieldInitializer], ["aLetOfAnotherModule", aLetOfAnotherModule], ["aLetBehindANamespace", aLetBehindANamespace], ["aNamespaceWithALet", aNamespaceWithALet], ["aStaticField", aStaticField], ["aProperty", aProperty], ["aSpread", aSpread], ["anAssign", anAssign], ["theKeys", theKeys], ["theValues", theValues], ["theEntries", theEntries], ["theDescriptors", theDescriptors], ["aSpreadOfAList", aSpreadOfAList], ["aMapOverAList", aMapOverAList], ["aSliceOfAList", aSliceOfAList], ["theLengthOfAList", theLengthOfAList], ["aSetOfAList", aSetOfAList], ["aJoinOfAList", aJoinOfAList], ["aPropertyOfWhatAConstantHolds", aPropertyOfWhatAConstantHolds], ["aPropertyOfWhatAFrozenConstantHolds", aPropertyOfWhatAFrozenConstantHolds], ["aPropertyThroughAHelper", aPropertyThroughAHelper], ["aPropertyThroughAPattern", aPropertyThroughAPattern], ["aMapEntry", aMapEntry], ["theSizeOfAMap", theSizeOfAMap], ["whetherItIsFrozen", whetherItIsFrozen], ["aPropertyOfAFunction", aPropertyOfAFunction], ["aMethodThatIsReplaced", aMethodThatIsReplaced], ["aGlobal", aGlobal], ["aPropertyStoredToThroughARestElement", aPropertyStoredToThroughARestElement], ["aPropertyStoredToThroughAPattern", aPropertyStoredToThroughAPattern], ["aPropertyStoredToInALoopHead", aPropertyStoredToInALoopHead], ["aPropertyStoredToThroughAnAlias", aPropertyStoredToThroughAnAlias], ["aPropertyStoredToThroughAParameter", aPropertyStoredToThroughAParameter], ["aPropertyThatIsDeleted", aPropertyThatIsDeleted], ["aPropertyThatIsDefinedAgain", aPropertyThatIsDefinedAgain], ["aPropertyStoredToByAnotherModule", aPropertyStoredToByAnotherModule]]; }
step = 10;
maybe = {};
Counter.count = 10;
changing.a = 9;
growing.z = 9;
list.push(9);
holder.inner.a = 9;
frozen.inner.a = 9;
table.set("k", 9).set("z", 9);
Object.freeze(frozenLater);
(counted as unknown as { calls: number }).calls = 9;
tools.name = () => "late";
(globalThis as unknown as { marker?: string }).marker = "late";
[...withRest.rest] = [9];
[withPattern.a] = [9];
for (withLoopHead.a of [9]) {}
const alias = withAlias;
alias.a = 9;
store(withParameter);
delete withDelete.a;
Object.defineProperty(withDefine, "a", { value: 9 });
change();
for (const [name, value] of readAll()) console.log(name, show(value));
