// A function called once returns what Symbol creates, and a built-in stores it: the property holds that symbol, as a value and as a key.
function show(label, value) {
  console.log(label, typeof value === "symbol" ? String(value) : value);
}

function makeDog() { return Symbol("dog"); }
const defined = {};
Object.defineProperty(defined, "pet", { value: makeDog(), writable: true, enumerable: true, configurable: true });
show("defined legs", defined.pet.legs);
show("defined typeof", typeof defined.pet);
show("defined text", String(defined.pet));
show("defined description", defined.pet.description);

function makeCat() { return Symbol("cat"); }
const reflected = {};
Reflect.set(reflected, "pet", makeCat());
show("reflected legs", reflected.pet.legs);
show("reflected text", reflected.pet.toString());

function makeBird() { return Symbol("bird"); }
show("typeof alone", typeof makeBird());

function makeNameless() { return Symbol(); }
const nameless = makeNameless();
show("nameless", nameless);
show("nameless description", nameless.description);

const makeArrow = () => Symbol("arrow");
const fromArrow = makeArrow();
show("arrow", fromArrow);
show("arrow is itself", fromArrow === fromArrow);

function makeThroughAnother() { return makeInner(); }
function makeInner() { return Symbol("inner"); }
const throughAnother = makeThroughAnother();
const heldByAnother = { [throughAnother]: "held" };
show("through another", heldByAnother[throughAnother]);
show("own symbols", Object.getOwnPropertySymbols(heldByAnother).length);
show("own symbol is it", Object.getOwnPropertySymbols(heldByAnother)[0] === throughAnother);

const holderOfMethod = { make() { return Symbol("method"); } };
const fromMethod = holderOfMethod.make();
const assigned = {};
Object.assign(assigned, { pet: fromMethod });
show("assigned", assigned.pet);
show("assigned is it", assigned.pet === fromMethod);

function makeKey() { return Symbol("key"); }
const key = makeKey();
const keyed = {};
Object.defineProperty(keyed, key, { value: 7, writable: true, enumerable: true, configurable: true });
show("keyed", keyed[key]);
show("keyed has", Object.hasOwn(keyed, key));
show("keyed by another", keyed[Symbol("key")]);
show("keyed keys", Reflect.ownKeys(keyed).length);
show("keyed first is it", Reflect.ownKeys(keyed)[0] === key);

function makeKept() { return Symbol("kept"); }
const kept = makeKept();
const holdsKept = {};
Object.defineProperty(holdsKept, "pet", { value: kept, writable: true, enumerable: true, configurable: true });
show("kept is it", holdsKept.pet === kept);
show("kept among values", Object.values(holdsKept)[0] === kept);
show("kept by descriptor", Object.getOwnPropertyDescriptor(holdsKept, "pet").value === kept);
holdsKept.pet = Symbol("other");
show("kept replaced", holdsKept.pet !== kept);
show("kept replaced text", holdsKept.pet);
