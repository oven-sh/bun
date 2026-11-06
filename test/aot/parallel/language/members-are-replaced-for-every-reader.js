// A member of a built-in object of the language is constant unless written. A store replaces it for every reader, however the object and the name are spelled, and also where it arrives by a way the compiler does not follow, here a proxy around the object.
function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }
function replacement() { return "replaced"; }

const dateNow = Date.now;
const alias = Date;
alias["n" + "ow"] = replacement;
console.log("through another name:", Date.now(), alias.now(), Date["now"](), Date.now === dateNow);

const parseFloatOfNumber = Number.parseFloat;
function store(holder, name) { holder[name] = replacement; }
store(Number, ["parseFloat", "toString"][Date.length - 7]);
console.log("through a helper:", Number.parseFloat("1.5"), Number["parseFloat"]("1.5"), Number.parseFloat === parseFloatOfNumber);

const stringify = JSON.stringify;
const proxy = new Proxy(JSON, {});
console.log("store through a proxy:", attempt(() => { proxy.stringify = replacement; return "done"; }));
console.log("Reflect.set through a proxy:", attempt(() => Reflect.set(proxy, "stringify", replacement)));
console.log("definition through a proxy:", attempt(() => Reflect.defineProperty(proxy, "stringify", { value: replacement })));
console.log("deletion through a proxy:", attempt(() => Reflect.deleteProperty(proxy, "stringify")));
console.log("readers:", attempt(() => JSON.stringify([1])), attempt(() => proxy.stringify([1])), attempt(() => JSON["stringify"]([1])), JSON.stringify === stringify);

proxy.added = 7;
console.log("a name of the program's own:", JSON.added, delete proxy.added, JSON.added);
