// What lies above the objects that a constructor makes is changed on roads that do not spell it out: the `prototype` property of a constructor function is replaced,
// or the prototype object of a function or a class gets another object above it or an accessor of its own, by a computed key, a built-in, a built-in reached by call, apply, bind or a spread,
// a copy, a function that came back out of native code, or another new.target. What lies there afterwards has a setter and a getter for `pos`, which the constructor fills:
// the objects made from then on have no `pos` of their own. Each road has a constructor and readers of its own, so that nothing but that road decides what the readers may take for granted.
const kept = [];
const spy = {
  set pos(value) {
    kept.push(value);
  },
  get pos() {
    return "read";
  },
};
function takes(value) {
  kept.push(value);
}
function gives() {
  return "read";
}
function storeUnder(target, key, value) {
  target[key] = value;
}
const names = ["prototype", "__proto__", "pos"];
function nameAt(index) {
  return names[index % names.length];
}
function report(label, made, pos, end, isInstance, firstIsInstance) {
  console.log(label + ":", Object.hasOwn(made, "pos"), typeof pos, typeof pos === "object" ? pos.tag : String(pos), end, isInstance, firstIsInstance, Object.getPrototypeOf(made) === spy, kept.length);
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made.prototype = spy;
  const late = new Made({ tag: 1 }, 2);
  report("the name is spelled " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  storeUnder(Made, ["proto", "type"].join(""), spy);
  const late = new Made({ tag: 1 }, 2);
  report("a key that is joined " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made[nameAt(0)] = spy;
  const late = new Made({ tag: 1 }, 2);
  report("a key out of an array " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  const half = "proto"; Made[`${half}type`] = spy;
  const late = new Made({ tag: 1 }, 2);
  report("a key out of a template " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made[kept.length >= 0 ? "prototype" : "other"] = spy;
  const late = new Made({ tag: 1 }, 2);
  report("one of two keys " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  function replace(target) {
    target.prototype = spy;
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  replace(Made);
  const late = new Made({ tag: 1 }, 2);
  report("through a parameter " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.set(Made, "prototype", spy);
  const late = new Made({ tag: 1 }, 2);
  report("Reflect.set " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.set(Made, nameAt(0), spy);
  const late = new Made({ tag: 1 }, 2);
  report("Reflect.set, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.set(...[Made, "prototype", spy]);
  const late = new Made({ tag: 1 }, 2);
  report("Reflect.set, spread " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.apply(Reflect.set, undefined, [Made, "prototype", spy]);
  const late = new Made({ tag: 1 }, 2);
  report("Reflect.set by apply " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty(Made, "prototype", { value: spy });
  const late = new Made({ tag: 1 }, 2);
  report("Object.defineProperty " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty(Made, nameAt(0), { value: spy });
  const late = new Made({ tag: 1 }, 2);
  report("Object.defineProperty, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty.call(null, Made, "prototype", { value: spy });
  const late = new Made({ tag: 1 }, 2);
  report("Object.defineProperty by call " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty.bind(null, Made)("prototype", { value: spy });
  const late = new Made({ tag: 1 }, 2);
  report("Object.defineProperty, bound " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  function describe(value) {
    return { value };
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty(Made, "prototype", describe(spy));
  const late = new Made({ tag: 1 }, 2);
  report("Object.defineProperty, a descriptor out of a function " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.defineProperty(Made, "prototype", { value: spy });
  const late = new Made({ tag: 1 }, 2);
  report("Reflect.defineProperty " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperties(Made, { prototype: { value: spy } });
  const late = new Made({ tag: 1 }, 2);
  report("Object.defineProperties " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperties(Made, { [nameAt(0)]: { value: spy } });
  const late = new Made({ tag: 1 }, 2);
  report("Object.defineProperties, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.assign(Made, { prototype: spy });
  const late = new Made({ tag: 1 }, 2);
  report("Object.assign " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.assign(Made, { [nameAt(0)]: spy });
  const late = new Made({ tag: 1 }, 2);
  report("Object.assign, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.assign(Made, Object.fromEntries([["prototype", spy]]));
  const late = new Made({ tag: 1 }, 2);
  report("Object.assign from entries " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.assign(Made, { get prototype() { return spy; } });
  const late = new Made({ tag: 1 }, 2);
  report("Object.assign from a getter " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  const from = { prototype: spy }; for (const key in from) Made[key] = from[key];
  const late = new Made({ tag: 1 }, 2);
  report("a loop that copies " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  storeUnder(...[Made, "prototype", spy]);
  const late = new Made({ tag: 1 }, 2);
  report("a spread into a call " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  const held = [Made]; held[0].prototype = spy;
  const late = new Made({ tag: 1 }, 2);
  report("the function out of an array " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  const held = [Made]; held[0][nameAt(0)] = spy;
  const late = new Made({ tag: 1 }, 2);
  report("the function out of an array, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  new Map([[1, Made]]).get(1).prototype = spy;
  const late = new Made({ tag: 1 }, 2);
  report("the function out of a map " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.values({ Made })[0].prototype = spy;
  const late = new Made({ tag: 1 }, 2);
  report("the function out of Object.values " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  new CustomEvent("made", { detail: Made }).detail.prototype = spy;
  const late = new Made({ tag: 1 }, 2);
  report("the function out of an event " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  first.constructor.prototype = spy;
  const late = new Made({ tag: 1 }, 2);
  report("the function out of the constructor property " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  first[["const", "ructor"].join("")].prototype = spy;
  const late = new Made({ tag: 1 }, 2);
  report("the function out of the constructor property, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made[nameAt(0)] = 1;
  const late = new Made({ tag: 1 }, 2);
  report("what is no object " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  function Other() {}
  Other.prototype = spy;
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  
  const late = Reflect.construct(Made, [{ tag: 1 }, 2], Other);
  report("another new.target " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  function Other() {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Other[nameAt(0)] = spy;
  const late = Reflect.construct(Made, [{ tag: 1 }, 2], Other);
  report("another new.target, its prototype under a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  
  const late = new (new Proxy(Made, { get: (target, key, receiver) => (key === "prototype" ? spy : Reflect.get(target, key, receiver)) }))({ tag: 1 }, 2);
  report("a proxy as new.target " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made[nameAt(0)] = spy;
  const late = new (Made.bind(null, { tag: 1 }))(2);
  report("a bound function whose target was changed " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  function Other() {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Other[nameAt(0)] = spy;
  const late = Reflect.construct(Made, [{ tag: 1 }, 2], Other.bind(null));
  report("a bound function as new.target " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  class Below extends Made {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made[nameAt(0)] = spy;
  const late = new Below({ tag: 1 }, 2);
  report("a class below the function " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made[nameAt(0)] = spy;
  const late = new (class extends Made {})({ tag: 1 }, 2);
  report("a class below the function, made afterwards " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  storeUnder(Made.prototype, ["__pro", "to__"].join(""), spy);
  const late = new Made({ tag: 1 }, 2);
  report("above the prototype object, __proto__ joined " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made.prototype[nameAt(1)] = spy;
  const late = new Made({ tag: 1 }, 2);
  report("above the prototype object, __proto__ out of an array " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.setPrototypeOf(Made.prototype, spy);
  const late = new Made({ tag: 1 }, 2);
  report("above the prototype object, Reflect.setPrototypeOf " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.setPrototypeOf.apply(null, [Made.prototype, spy]);
  const late = new Made({ tag: 1 }, 2);
  report("above the prototype object, setPrototypeOf by apply " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(Made.prototype, spy);
  const late = new Made({ tag: 1 }, 2);
  report("above the prototype object, the setter of __proto__ " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.setPrototypeOf(Object.getPrototypeOf(first), spy);
  const late = new Made({ tag: 1 }, 2);
  report("above the prototype object, found from an instance " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.setPrototypeOf(Made.prototype, new Proxy({}, { set: (target, key, value) => (kept.push(value), true), get: () => "read" }));
  const late = new Made({ tag: 1 }, 2);
  report("above the prototype object, a proxy " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty(Made.prototype, nameAt(2), { set: takes, get: gives });
  const late = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperties(Made.prototype, { [nameAt(2)]: { set: takes, get: gives } });
  const late = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, a map with a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made.prototype.__defineSetter__(nameAt(2), takes); Made.prototype.__defineGetter__(nameAt(2), gives);
  const late = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, the old way " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.apply(Reflect.defineProperty, null, [Made.prototype, "pos", { set: takes, get: gives }]);
  const late = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, Reflect by apply " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty(Object.getPrototypeOf(first), "pos", { set: takes, get: gives });
  const late = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, found from an instance " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  function Made(pos, end) {
    this.pos = pos;
    this.end = end;
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty(Made.prototype, nameAt(2), { value: "read", writable: false });
  const late = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: error.constructor.name, end: 0 }; } })();
  report("a read-only property on the prototype object, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  storeUnder(Made.prototype, ["__pro", "to__"].join(""), spy);
  const late = new Made({ tag: 1 }, 2);
  report("a class, above the prototype object, __proto__ joined " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made.prototype[nameAt(1)] = spy;
  const late = new Made({ tag: 1 }, 2);
  report("a class, above the prototype object, __proto__ out of an array " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.setPrototypeOf(Made.prototype, spy);
  const late = new Made({ tag: 1 }, 2);
  report("a class, above the prototype object, Reflect.setPrototypeOf " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.setPrototypeOf(...[Made.prototype, spy]);
  const late = new Made({ tag: 1 }, 2);
  report("a class, above the prototype object, setPrototypeOf spread " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Object.defineProperty(Made.prototype, nameAt(2), { set: takes, get: gives });
  const late = new Made({ tag: 1 }, 2);
  report("a class, an accessor on the prototype object, a computed key " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Made.prototype.__defineSetter__(nameAt(2), takes); Made.prototype.__defineGetter__(nameAt(2), gives);
  const late = new Made({ tag: 1 }, 2);
  report("a class, an accessor on the prototype object, the old way " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  try { storeUnder(Made, nameAt(0), spy); } catch (error) { kept.push(error.constructor.name); }
  const late = new Made({ tag: 1 }, 2);
  report("a class, its prototype property cannot be replaced " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  function Other() {}
  Other[nameAt(0)] = spy;
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  
  const late = Reflect.construct(Made, [{ tag: 1 }, 2], Other);
  report("a class, another new.target " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  
  const late = (() => { try { return new (new Proxy(Made, { get: (target, key, receiver) => (key === "prototype" ? spy : Reflect.get(target, key, receiver)) }))({ tag: 1 }, 2); } catch (error) { return { pos: error.constructor.name, end: 0 }; } })();
  report("a class, a proxy as new.target " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  class Below extends Made {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Reflect.setPrototypeOf(Made.prototype, spy);
  const late = new Below({ tag: 1 }, 2);
  report("a class below a class, the link between the prototype objects " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
{
  class Made {
    constructor(pos, end) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made) {
    return made.pos;
  }
  function endOf(made) {
    return made.end;
  }
  function isMade(made) {
    try {
      return made instanceof Made;
    } catch (error) {
      return error.constructor.name;
    }
  }
  class Below extends Made {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made);
  }
  Below.prototype[nameAt(1)] = spy;
  const late = new Below({ tag: 1 }, 2);
  report("a class below a class, above the lower prototype object " + early, late, posOf(late), endOf(late), isMade(late), isMade(first));
}
