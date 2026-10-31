// A function declares a name that a closure names too, suspends, and collections run. Nothing behind the suspension names it again, so an executable lets go of what it holds, whatever stands
// there: a name from outside, a parameter, a closure that is made, the end of a block, a jump out of a block. `bun run` keeps the names that closures share in one object for each scope, and a
// suspended function holds that object where the text behind the suspension reads the scope: docs/compiler/compatibility.mdx, "Memory".
let last;
let sink = 0;
const nothing = globalThis[process.argv[2] ?? "nothing"];
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
async function pause(label) {
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
  }
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  return 1;
}
async function* pauses(label) {
  yield await pause(label);
}

async function aNameOfTheModuleBehind(n) {
  const L = "a name of the module behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aNameOfTheModuleBehind(n);
async function nothingBehind(n) {
  const L = "nothing behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return 1;
}
for (let n = 0; n < 1; n++) await nothingBehind(n);
async function aParameterBehind(n) {
  const L = "a parameter behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return n;
}
for (let n = 0; n < 1; n++) await aParameterBehind(n);
async function aLocalBehind(n) {
  const L = "a local behind";
  const x = make(n);
  const late = () => x.n;
  const k = n + 1;
  await pause(L);
  return k;
}
for (let n = 0; n < 1; n++) await aLocalBehind(n);
async function aTryAndFinallyWithANameOfTheModule(n) {
  const L = "a try and finally with a name of the module";
  const x = make(n);
  const late = () => x.n;
  try {
    await pause(L);
  } finally {
    sink++;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await aTryAndFinallyWithANameOfTheModule(n);
async function aTryAndFinallyWithALocal(n) {
  const L = "a try and finally with a local";
  const x = make(n);
  const late = () => x.n;
  let k = 0;
  try {
    await pause(L);
  } finally {
    k++;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await aTryAndFinallyWithALocal(n);
async function aTryAndCatchWithALocal(n) {
  const L = "a try and catch with a local";
  const x = make(n);
  const late = () => x.n;
  let k = 0;
  try {
    await pause(L);
  } catch {
    k++;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await aTryAndCatchWithALocal(n);
async function aForAwaitLoop(n) {
  const L = "a for await loop";
  const x = make(n);
  const late = () => x.n;
  for await (const step of pauses(L)) sink += step;
  return 1;
}
for (let n = 0; n < 1; n++) await aForAwaitLoop(n);
async function standsInAFinallyBlock(n) {
  const L = "stands in a finally block";
  const x = make(n);
  const late = () => x.n;
  let k = 0;
  try {
    k++;
  } finally {
    await pause(L);
  }
  return 1;
}
for (let n = 0; n < 1; n++) await standsInAFinallyBlock(n);
async function standsInACatchBlock(n) {
  const L = "stands in a catch block";
  const x = make(n);
  const late = () => x.n;
  try {
    throw 1;
  } catch {
    await pause(L);
  }
  return 1;
}
for (let n = 0; n < 1; n++) await standsInACatchBlock(n);
async function aBlockThatIsLeftInFront(n) {
  const L = "a block that is left in front";
  {
    const x = make(n);
    const late = () => x.n;
  }
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aBlockThatIsLeftInFront(n);
async function aClosureOnAPathThatIsNotTaken(n) {
  const L = "a closure on a path that is not taken";
  const x = make(n);
  if (nothing) {
    const late = () => x.n;
  }
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aClosureOnAPathThatIsNotTaken(n);
async function declaredByLet(n) {
  const L = "declared by let";
  let x = make(n);
  const late = () => x.n;
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await declaredByLet(n);
async function declaredByLetStoredLater(n) {
  const L = "declared by let, stored later";
  let x = null;
  const late = () => x.n;
  x = make(n);
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await declaredByLetStoredLater(n);
async function declaredByLetCleared(n) {
  const L = "declared by let, cleared";
  let x = make(n);
  const late = () => x.n;
  x = null;
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await declaredByLetCleared(n);
async function declaredByVar(n) {
  const L = "declared by var";
  var x = make(n);
  const late = () => x.n;
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await declaredByVar(n);
async function anInnerBlockWithASharedNameOfItsOwn(n) {
  const L = "an inner block with a shared name of its own";
  const x = make(n);
  const late = () => x.n;
  {
    const y = {};
    const other = () => y;
    await pause(L);
  }
  return 1;
}
for (let n = 0; n < 1; n++) await anInnerBlockWithASharedNameOfItsOwn(n);
async function anInnerBlockWithoutOne(n) {
  const L = "an inner block without one";
  const x = make(n);
  const late = () => x.n;
  {
    const y = {};
    await pause(L);
  }
  return 1;
}
for (let n = 0; n < 1; n++) await anInnerBlockWithoutOne(n);
async function aClosureMadeBehind(n) {
  const L = "a closure made behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return () => 1;
}
for (let n = 0; n < 1; n++) await aClosureMadeBehind(n);
async function aClassMadeBehind(n) {
  const L = "a class made behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return class {};
}
for (let n = 0; n < 1; n++) await aClassMadeBehind(n);
async function aGlobalBehind(n) {
  const L = "a global behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return Math.max(1, 2);
}
for (let n = 0; n < 1; n++) await aGlobalBehind(n);
async function theTypeOfANameNobodyDeclaresBehind(n) {
  const L = "the type of a name nobody declares behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return typeof nobody;
}
for (let n = 0; n < 1; n++) await theTypeOfANameNobodyDeclaresBehind(n);
async function theValueUndefinedBehind(n) {
  const L = "the value undefined behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return undefined;
}
for (let n = 0; n < 1; n++) await theValueUndefinedBehind(n);
async function theReceiverBehind(n) {
  const L = "the receiver behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return this;
}
for (let n = 0; n < 1; n++) await theReceiverBehind(n);
async function theArgumentsObjectBehind(n) {
  const L = "the arguments object behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return arguments.length;
}
for (let n = 0; n < 1; n++) await theArgumentsObjectBehind(n);
async function theMetaObjectOfTheModuleBehind(n) {
  const L = "the meta object of the module behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return import.meta.main;
}
for (let n = 0; n < 1; n++) await theMetaObjectOfTheModuleBehind(n);
async function aRegularExpressionBehind(n) {
  const L = "a regular expression behind";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  return /a/;
}
for (let n = 0; n < 1; n++) await aRegularExpressionBehind(n);
async function aNameOfTheModuleOnAPathThatIsNotTaken(n) {
  const L = "a name of the module on a path that is not taken";
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  if (n < 0) sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aNameOfTheModuleOnAPathThatIsNotTaken(n);
async function aNameOfTheModuleBehindAReturn(n) {
  const L = "a name of the module behind a return";
  const x = make(n);
  const late = () => x.n;
  if (n >= 0) {
    await pause(L);
    return 1;
  }
  sink++;
  return 2;
}
for (let n = 0; n < 1; n++) await aNameOfTheModuleBehindAReturn(n);
async function aNameOfTheModuleInFrontInALoop(n) {
  const L = "a name of the module in front, in a loop";
  const x = make(n);
  const late = () => x.n;
  const p = pause(L);
  for (let turn = 0; turn < 1; turn++) {
    sink++;
    await p;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await aNameOfTheModuleInFrontInALoop(n);
async function aNameOfTheModuleInFront(n) {
  const L = "a name of the module in front";
  const x = make(n);
  const late = () => x.n;
  sink++;
  await pause(L);
  return 1;
}
for (let n = 0; n < 1; n++) await aNameOfTheModuleInFront(n);
async function aLoopWithoutNames(n) {
  const L = "a loop without names";
  const x = make(n);
  const late = () => x.n;
  const p = pause(L);
  for (let turn = 0; turn < 1; turn++) {
    await p;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await aLoopWithoutNames(n);
async function anArgumentBehindTheAwaitInOneCall(n) {
  const L = "an argument behind the await in one call";
  const x = make(n);
  const late = () => x.n;
  const take = (a, b) => 1;
  return take(await pause(L), sink);
}
for (let n = 0; n < 1; n++) await anArgumentBehindTheAwaitInOneCall(n);
async function anArgumentInFrontOfTheAwaitInOneCall(n) {
  const L = "an argument in front of the await in one call";
  const x = make(n);
  const late = () => x.n;
  const take = Math.max;
  return take(sink, await pause(L));
}
for (let n = 0; n < 1; n++) await anArgumentInFrontOfTheAwaitInOneCall(n);
async function aFunctionDeclarationNamesIt(n) {
  const L = "a function declaration names it";
  const x = make(n);
  function late() {
    return x.n;
  }
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aFunctionDeclarationNamesIt(n);
async function aClosureInAClosureNamesIt(n) {
  const L = "a closure in a closure names it";
  const x = make(n);
  const late = () => () => x.n;
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aClosureInAClosureNamesIt(n);
async function aGetterOfALiteralNamesIt(n) {
  const L = "a getter of a literal names it";
  const x = make(n);
  const o = {
    get g() {
      return x.n;
    },
  };
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aGetterOfALiteralNamesIt(n);
async function aDefaultOfAParameterNamesIt(n) {
  const L = "a default of a parameter names it";
  const x = make(n);
  const late = (a = x.n) => a;
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aDefaultOfAParameterNamesIt(n);
async function namesThatNoClosureNames(n) {
  const L = "names that no closure names";
  const x = make(n);
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await namesThatNoClosureNames(n);
async function closuresNameAnother(n) {
  const L = "closures name another";
  const x = make(n);
  const y = {};
  const late = () => y;
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await closuresNameAnother(n);
async function anotherSharedNameOfTheScopeReadBehind(n) {
  const L = "another shared name of the scope read behind";
  const x = make(n);
  const y = { n };
  const late = () => x.n + y.n;
  await pause(L);
  return y.n;
}
for (let n = 0; n < 1; n++) await anotherSharedNameOfTheScopeReadBehind(n);
async function aSharedNameOfAnOuterScopeReadBehind(n) {
  const L = "a shared name of an outer scope read behind";
  const y = { n: 1 };
  const first = () => y;
  {
    const x = make(n);
    const late = () => x.n;
    await pause(L);
    return y.n;
  }
}
for (let n = 0; n < 1; n++) await aSharedNameOfAnOuterScopeReadBehind(n);
async function fallsOutOfItsBlock(n) {
  const L = "falls out of its block";
  const p = pause(L);
  {
    const x = make(n);
    const late = () => x.n;
    await p;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await fallsOutOfItsBlock(n);
async function breaksOutOfItsBlock(n) {
  const L = "breaks out of its block";
  const p = pause(L);
  out: {
    const x = make(n);
    const late = () => x.n;
    await p;
    break out;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await breaksOutOfItsBlock(n);
async function breaksOutOfItsBlockANameOfTheModuleBehind(n) {
  const L = "breaks out of its block, a name of the module behind";
  const p = pause(L);
  out: {
    const x = make(n);
    const late = () => x.n;
    await p;
    break out;
  }
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await breaksOutOfItsBlockANameOfTheModuleBehind(n);
async function breaksOutOfAnInnerBlockWithASharedName(n) {
  const L = "breaks out of an inner block with a shared name";
  const x = make(n);
  const late = () => x.n;
  const p = pause(L);
  out: {
    const y = {};
    const other = () => y;
    await p;
    break out;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await breaksOutOfAnInnerBlockWithASharedName(n);
async function breaksOutOfAnInnerBlockWithoutOne(n) {
  const L = "breaks out of an inner block without one";
  const x = make(n);
  const late = () => x.n;
  const p = pause(L);
  out: {
    await p;
    break out;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await breaksOutOfAnInnerBlockWithoutOne(n);
async function aTryBlockWithASharedNameOfItsOwn(n) {
  const L = "a try block with a shared name of its own";
  try {
    const x = make(n);
    const late = () => x.n;
    await pause(L);
  } catch {}
  return 1;
}
for (let n = 0; n < 1; n++) await aTryBlockWithASharedNameOfItsOwn(n);
async function aTryBlockThatHoldsABlockWithASharedName(n) {
  const L = "a try block that holds a block with a shared name";
  const x = make(n);
  const late = () => x.n;
  const p = pause(L);
  let k = 0;
  try {
    await p;
    {
      const y = {};
      const other = () => y;
    }
  } catch {
    k++;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await aTryBlockThatHoldsABlockWithASharedName(n);
async function aCatchVariable(n) {
  const L = "a catch variable";
  try {
    throw make(n);
  } catch (x) {
    const late = () => x.n;
    await pause(L);
    sink++;
  }
  return 1;
}
for (let n = 0; n < 1; n++) await aCatchVariable(n);
async function aCatchVariableLeft(n) {
  const L = "a catch variable, left";
  try {
    throw make(n);
  } catch (x) {
    const late = () => x.n;
  }
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aCatchVariableLeft(n);
async function aLoopVariableLeft(n) {
  const L = "a loop variable, left";
  for (const x of [make(n)]) {
    const late = () => x.n;
  }
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await aLoopVariableLeft(n);
async function whatIsAwaitedIsAddedToANameOfTheModule(n) {
  const L = "what is awaited is added to a name of the module";
  const x = make(n);
  const late = () => x.n;
  sink += await pause(L);
}
for (let n = 0; n < 1; n++) await whatIsAwaitedIsAddedToANameOfTheModule(n);
async function whatIsAwaitedIsStoredIntoANameOfTheModule(n) {
  const L = "what is awaited is stored into a name of the module";
  const x = make(n);
  const late = () => x.n;
  sink = await pause(L);
}
for (let n = 0; n < 1; n++) await whatIsAwaitedIsStoredIntoANameOfTheModule(n);
async function whatIsAwaitedIsStoredIntoAParameter(n) {
  const L = "what is awaited is stored into a parameter";
  const x = make(n);
  const late = () => x.n;
  n = await pause(L);
}
for (let n = 0; n < 1; n++) await whatIsAwaitedIsStoredIntoAParameter(n);
async function whatIsAwaitedIsStoredIntoAnotherSharedName(n) {
  const L = "what is awaited is stored into another shared name";
  const x = make(n);
  let y = 0;
  const late = () => x.n + y;
  y = await pause(L);
}
for (let n = 0; n < 1; n++) await whatIsAwaitedIsStoredIntoAnotherSharedName(n);
async function anArrowFunctionMadeBehindNamesTheReceiver(n) {
  const L = "an arrow function made behind names the receiver";
  const x = make(n);
  await pause(L);
  return (() => this)();
}
for (let n = 0; n < 1; n++) await anArrowFunctionMadeBehindNamesTheReceiver(n);
async function declaredBehindAnotherSuspension(n) {
  const L = "declared behind another suspension";
  await 0;
  const x = make(n);
  const late = () => x.n;
  await pause(L);
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) await declaredBehindAnotherSuspension(n);
const arrowNothingBehind = async n => {
  const x = make(n);
  const late = () => x.n;
  await pause("an async arrow function, nothing behind");
  return 1;
};
for (let n = 0; n < 1; n++) await arrowNothingBehind(n);
const holderNothingBehind = {
  async method(n) {
    const x = make(n);
    const late = () => x.n;
    await pause("an async method, nothing behind");
    return 1;
  },
};
for (let n = 0; n < 1; n++) await holderNothingBehind.method(n);
function* stepsNothingBehind(n) {
  const x = make(n);
  const late = () => x.n;
  yield 1;
  return 1;
}
for (let n = 0; n < 1; n++) {
  const walker = stepsNothingBehind(n);
  walker.next();
  await pause("a generator, nothing behind");
  walker.next();
}
async function* asyncStepsNothingBehind(n) {
  const x = make(n);
  const late = () => x.n;
  yield 1;
  return 1;
}
for (let n = 0; n < 1; n++) {
  const walker = asyncStepsNothingBehind(n);
  await walker.next();
  await pause("an async generator, nothing behind");
  await walker.next();
}
function* delegatesNothingBehind(n) {
  const x = make(n);
  const late = () => x.n;
  yield* [1];
  return 1;
}
for (let n = 0; n < 1; n++) {
  const walker = delegatesNothingBehind(n);
  walker.next();
  await pause("yield*, nothing behind");
  walker.next();
}
const arrowANameOfTheModuleBehind = async n => {
  const x = make(n);
  const late = () => x.n;
  await pause("an async arrow function, a name of the module behind");
  sink++;
  return 1;
};
for (let n = 0; n < 1; n++) await arrowANameOfTheModuleBehind(n);
const holderANameOfTheModuleBehind = {
  async method(n) {
    const x = make(n);
    const late = () => x.n;
    await pause("an async method, a name of the module behind");
    sink++;
    return 1;
  },
};
for (let n = 0; n < 1; n++) await holderANameOfTheModuleBehind.method(n);
function* stepsANameOfTheModuleBehind(n) {
  const x = make(n);
  const late = () => x.n;
  yield 1;
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) {
  const walker = stepsANameOfTheModuleBehind(n);
  walker.next();
  await pause("a generator, a name of the module behind");
  walker.next();
}
async function* asyncStepsANameOfTheModuleBehind(n) {
  const x = make(n);
  const late = () => x.n;
  yield 1;
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) {
  const walker = asyncStepsANameOfTheModuleBehind(n);
  await walker.next();
  await pause("an async generator, a name of the module behind");
  await walker.next();
}
function* delegatesANameOfTheModuleBehind(n) {
  const x = make(n);
  const late = () => x.n;
  yield* [1];
  sink++;
  return 1;
}
for (let n = 0; n < 1; n++) {
  const walker = delegatesANameOfTheModuleBehind(n);
  walker.next();
  await pause("yield*, a name of the module behind");
  walker.next();
}
/* Output:
a name of the module behind: collected
nothing behind: collected
a parameter behind: collected
a local behind: collected
a try and finally with a name of the module: collected
a try and finally with a local: collected
a try and catch with a local: collected
a for await loop: collected
stands in a finally block: collected
stands in a catch block: collected
a block that is left in front: collected
a closure on a path that is not taken: collected
declared by let: collected
declared by let, stored later: collected
declared by let, cleared: collected
declared by var: collected
an inner block with a shared name of its own: collected
an inner block without one: collected
a closure made behind: collected
a class made behind: collected
a global behind: collected
the type of a name nobody declares behind: collected
the value undefined behind: collected
the receiver behind: collected
the arguments object behind: collected
the meta object of the module behind: collected
a regular expression behind: collected
a name of the module on a path that is not taken: collected
a name of the module behind a return: collected
a name of the module in front, in a loop: collected
a name of the module in front: collected
a loop without names: collected
an argument behind the await in one call: collected
an argument in front of the await in one call: collected
a function declaration names it: collected
a closure in a closure names it: collected
a getter of a literal names it: collected
a default of a parameter names it: collected
names that no closure names: collected
closures name another: collected
another shared name of the scope read behind: collected
a shared name of an outer scope read behind: collected
falls out of its block: collected
breaks out of its block: collected
breaks out of its block, a name of the module behind: collected
breaks out of an inner block with a shared name: collected
breaks out of an inner block without one: collected
a try block with a shared name of its own: collected
a try block that holds a block with a shared name: collected
a catch variable: collected
a catch variable, left: collected
a loop variable, left: collected
what is awaited is added to a name of the module: collected
what is awaited is stored into a name of the module: collected
what is awaited is stored into a parameter: collected
what is awaited is stored into another shared name: collected
an arrow function made behind names the receiver: collected
declared behind another suspension: collected
an async arrow function, nothing behind: collected
an async method, nothing behind: collected
a generator, nothing behind: collected
an async generator, nothing behind: collected
yield*, nothing behind: collected
an async arrow function, a name of the module behind: collected
an async method, a name of the module behind: collected
a generator, a name of the module behind: collected
an async generator, a name of the module behind: collected
yield*, a name of the module behind: collected
*/
