// What a function that is known for certain returns is known for certain too: a variable that holds it is called directly, without a test.
// IR= 0 ofAKnownMaker boolean = IsClosureOf
// IR= 0 ofAnImmediateCall boolean = IsClosureOf
// IR= 0 ofAMakerThatGivesProperties boolean = IsClosureOf
// IR= 1 ofAMakerInALiteral boolean = IsClosureOf
// IR= 1 ofAMakerThatIsStoredTo boolean = IsClosureOf
// IR= 1 ofAnAsyncMaker boolean = IsClosureOf
// IR= 1 ofAMakerOfTwo boolean = IsClosureOf
function once(f) {
  let done = false;
  let value;
  return function () {
    if (!done) {
      done = true;
      value = f();
    }
    return value;
  };
}

function remembering(f) {
  const made = function (n) {
    if (!made.cache.has(n)) made.cache.set(n, f(n));
    return made.cache.get(n);
  };
  made.cache = new Map();
  return made;
}

const makers = { once };

let replaceable = function (f) {
  return () => f() + 1;
};
if (Date.now() < 0) replaceable = once;

async function later(f) {
  return () => f();
}

function oneOfTwo(f, first) {
  if (first) return () => f() + 2;
  return () => f() + 3;
}

const known = once(() => 40);
const immediate = (function () {
  let calls = 0;
  return () => ++calls;
})();
const remembered = remembering(n => n * 2);
const inALiteral = makers.once(() => 41);
const storedTo = replaceable(() => 42);
const promised = later(() => 43);
const two = oneOfTwo(() => 44, Date.now() < 0);

function ofAKnownMaker(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += known();
  return total;
}

function ofAnImmediateCall(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += immediate();
  return total;
}

function ofAMakerThatGivesProperties(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += remembered(i & 1);
  return total + remembered.cache.size;
}

function ofAMakerInALiteral(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += inALiteral();
  return total;
}

function ofAMakerThatIsStoredTo(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += storedTo();
  return total;
}

function ofAnAsyncMaker(n) {
  let said = "";
  for (let i = 0; i < n; i++) {
    try {
      said += promised();
    } catch (e) {
      said += e.name;
    }
  }
  return said;
}

function ofAMakerOfTwo(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += two();
  return total;
}

const held = [ofAKnownMaker, ofAnImmediateCall, ofAMakerThatGivesProperties, ofAMakerInALiteral, ofAMakerThatIsStoredTo, ofAnAsyncMaker, ofAMakerOfTwo];
console.log(held.map(f => f(3)).join());
