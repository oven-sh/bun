// What an object inherits from is decided when it is made: by new.target, and by what the prototype property of a function holds at that moment. Each program here makes that differ from
// what the class or the function alone suggests, and then looks a member up. The last family hands one list to a call twice, as the receiver and as the arguments.

const attempt = "function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }\n";

export const makers: Record<string, string> = {
  "a class": 'class M { who() { return "M"; } get tag() { return "Mt"; } set put(v) { this.got = "M" + v; } }',
  "a class with fields": 'class M { a = 1; b = 2; who() { return "M" + this.a; } get tag() { return "Mt"; } set put(v) { this.got = "M" + v; } }',
  "a class below a class": 'class R { who() { return "R"; } get tag() { return "Rt"; } set put(v) { this.got = "R" + v; } }\nclass M extends R { who() { return "M" + super.who(); } }',
  "a function": 'function M() { this.a = 1; }\nM.prototype.who = function () { return "M"; };\nObject.defineProperty(M.prototype, "tag", { get() { return "Mt"; }, configurable: true });\nObject.defineProperty(M.prototype, "put", { set(v) { this.got = "M" + v; }, configurable: true });',
};

export const newTargets: Record<string, string> = {
  "a function": 'function T() {}\nT.prototype.who = function () { return "T"; };\nObject.defineProperty(T.prototype, "tag", { get() { return "Tt"; } });\nObject.defineProperty(T.prototype, "put", { set(v) { this.got = "T" + v; } });',
  "a function without members": "function T() {}",
  "another class": 'class T { who() { return "T"; } get tag() { return "Tt"; } set put(v) { this.got = "T" + v; } }',
  "a class below": 'class T extends M { who() { return "T"; } }',
  "a bound function": 'function U() {}\nU.prototype.who = function () { return "U"; };\nconst T = U.bind(null);',
  "a proxy": 'function U() {}\nU.prototype.who = function () { return "U"; };\nconst T = new Proxy(U, {});',
  "a function whose prototype is null": "function T() {}\nT.prototype = null;",
  "a function that inherits": 'function T() {}\nT.prototype = Object.create(M.prototype);\nT.prototype.who = function () { return "T"; };',
};

/** `o` is the object. */
export const questions: Record<string, string> = {
  "a call": "attempt(() => o.who())",
  "a getter": "o.tag",
  "a store": "(o.put = 1, o.got)",
  "in": '("who" in o) + "," + ("tag" in o)',
  "instanceof": '(o instanceof M) + "," + attempt(() => o instanceof T)',
  "its prototype": '(Object.getPrototypeOf(o) === M.prototype) + "," + (Object.getPrototypeOf(o) === T.prototype)',
};

/** «q» is the question. */
export const places: Record<string, string> = {
  "in a loop": "for (let i = 0; i < 2; i++) { const o = Reflect.construct(M, [], T); console.log(«q»); }",
  "between two questions to an instance": 'function run(m, n) { let s = ""; for (let i = 0; i < n; i++) { { const o = m; s += «q» + " "; } { const o = Reflect.construct(M, [], T); s += «q» + " "; } { const o = m; s += «q» + " "; } } return s; }\nconsole.log(run(new M(), 2));',
  "in turns with the maker itself": 'const list = [M, T, M, T];\nfunction run() { let s = ""; for (const t of list) { const o = Reflect.construct(M, [], t); s += «q» + " "; } return s; }\nconsole.log(run()); console.log(run());',
  "by a helper": 'function make(t) { return Reflect.construct(M, [], t); }\nlet s = "";\nfor (let i = 0; i < 4; i++) { const o = make(i < 2 ? M : T); s += «q» + " "; }\nconsole.log(s);',
};

export function madeFor(maker: string, newTarget: string, question: string, place: string) {
  return { file: "main.js", text: `${attempt}${makers[maker]}\n${newTargets[newTarget]}\n${places[place].replaceAll("«q»", questions[question])}\n` };
}

const members = '{ m() { return "new"; }, get g() { return "newg"; }, set s(v) { log.push("new" + v); } }';

export const newPrototypes: Record<string, string> = {
  "an object that inherits the members": `Object.create(${members})`,
  "an object with the members": members,
  "a literal that names its prototype": `{ __proto__: ${members} }`,
  "an empty object": "{}",
  "an object without a prototype": "Object.create(null)",
  "the same object": "F.prototype",
};

/** «p» is the new prototype object. */
export const replacements: Record<string, string> = {
  "a store": "F.prototype = «p»;",
  "Object.defineProperty": 'Object.defineProperty(F, "prototype", { value: «p» });',
  "Reflect.set": 'Reflect.set(F, "prototype", «p»);',
  "Object.assign": "Object.assign(F, { prototype: «p» });",
  "a computed key": 'F[["proto", "type"].join("")] = «p»;',
};

export const lookups: Record<string, { member: string; question: string }> = {
  "a call through super": { member: "m() { return super.m(); }", question: "attempt(() => new K().m())" },
  "a read through super": { member: "get g() { return super.g; }", question: "new K().g" },
  "a store through super": { member: "put(v) { super.s = v; }", question: "(new K().put(1), log.join())" },
  "an instance": { member: "other() {}", question: 'attempt(() => new K().m()) + "," + new K().g' },
};

/** «r» replaces the prototype object, «d» defines the class below, «q» is the question. */
export const orders: Record<string, string> = {
  "an object is made, the prototype is replaced, the class is defined": "new F();\n«r»\n«d»",
  "the prototype is replaced, the class is defined": "«r»\n«d»",
  "an object is made, the class is defined, the prototype is replaced": "new F();\n«d»\n«r»",
  "the class is defined, the prototype is replaced": "«d»\n«r»",
  "the class is defined and asked, the prototype is replaced": "«d»\nconsole.log(«q»);\n«r»",
  "the prototype is replaced, the class is defined, an object is made": "«r»\n«d»\nnew F();",
  "one class is defined before and one after": 'class J extends F { m() { return "J" + super.m(); } }\nconsole.log(new J().m());\n«r»\n«d»\nconsole.log(new J().m());',
};

export function replaced(newPrototype: string, replacement: string, lookup: string, order: string) {
  const { member, question } = lookups[lookup];
  const body = orders[order]
    .replace("«r»", replacements[replacement].replace("«p»", newPrototypes[newPrototype]))
    .replace("«d»", `class K extends F { ${member} }`)
    .replace("«q»", question);
  return {
    file: "main.js",
    text: `${attempt}const log = [];\nfunction F() { this.x; }\nF.prototype.m = function () { return "old"; };\nObject.defineProperty(F.prototype, "g", { get() { return "oldg"; }, configurable: true });\nObject.defineProperty(F.prototype, "s", { set(v) { log.push("old" + v); }, configurable: true });\n${body}\nconsole.log(${question});\nfor (let i = 0; i < 2; i++) console.log(${question}, attempt(() => new F().m()));\n`,
  };
}

/** «n» is the number of the step. */
export const lateMembers: Record<string, { member: string; use: string; define: string }> = {
  "a setter": { member: "put(v) { super.x = v; }", use: "k.put(«n»)", define: 'Object.defineProperty(F.prototype, "x", { set(v) { log.push(v); }, configurable: true });' },
  "a getter": { member: "take() { return super.x; }", use: "log.push(k.take())", define: 'Object.defineProperty(F.prototype, "x", { get() { return "late"; }, configurable: true });' },
  "a method": { member: "run() { return attempt(() => super.x()); }", use: "log.push(k.run())", define: 'F.prototype.x = function () { return "late"; };' },
};

export const parents: Record<string, string> = {
  "an assigned literal": "F.prototype = { constructor: F };",
  "a created object": "F.prototype = Object.create({});",
  "the object it was made with": "",
};

export const lastSteps: Record<string, string> = {
  "nothing more happens": "",
  "the class gets another parent": 'Object.setPrototypeOf(K.prototype, { set x(v) { log.push("o" + v); }, get x() { return () => "other"; } });',
  "the function makes an object": "new F();",
  "the member is deleted": "delete F.prototype.x;",
};

export function late(lateMember: string, parent: string, lastStep: string, makesObjectFirst: boolean) {
  const { member, use, define } = lateMembers[lateMember];
  let text = `${attempt}const log = [];\nfunction F() {}\n${parents[parent]}\n${makesObjectFirst ? "new F();\n" : ""}class K extends F { ${member} }\n`;
  ["", define, lastSteps[lastStep]].forEach((between, step) => {
    text += `${between}\n{ const k = new K(); ${use.replace("«n»", String(step))}; console.log(Object.keys(k).join(), log.join()); }\n`;
  });
  return { file: "main.js", text };
}

export const callees: Record<string, string> = { "a built-in": "Math.max", "a function": "describe", "a strict function": "strict" };

/** «u» is what the function does. */
export const lists: Record<string, { declared: string; list: string }> = {
  "arguments": { declared: "function f() { «u» }", list: "arguments" },
  "arguments beside parameters": { declared: "function f(a, b) { «u» }", list: "arguments" },
  "arguments of a strict function": { declared: 'function f(a) { "use strict"; «u» }', list: "arguments" },
  "a rest parameter": { declared: "function f(...r) { «u» }", list: "r" },
  "a literal": { declared: "function f(a, b) { const l = [a, b]; «u» }", list: "l" },
};

/** «c» is the callee, «l» the list. */
export const calls: Record<string, string> = {
  "apply": "«c».apply(«l», «l»)",
  "Reflect.apply": "Reflect.apply(«c», «l», «l»)",
  "call with a spread": "«c».call(«l», ...«l»)",
  "apply with another list": "«c».apply(«l», [«l».length])",
  "bind and apply": "«c».bind(«l»).apply(null, «l»)",
};

/** «x» is the call. */
export const positions: Record<string, string> = {
  "as an argument": "console.log(«x»);",
  "as the last thing": "return «x»;",
  "into a variable": "const v = «x»; return v;",
  "in a try": "try { return «x»; } finally { }",
  "twice": "return [«x», «x»].join();",
};

export function oneListTwice(callee: string, list: string, call: string, position: string) {
  const written = calls[call].replaceAll("«c»", callees[callee]).replaceAll("«l»", lists[list].list);
  return {
    file: "main.js",
    text: `function describe() { return [typeof this, this.length, arguments.length].join(); }\nfunction strict() { "use strict"; return [typeof this, this.length, arguments.length, this === arguments[0]].join(); }\n${lists[list].declared.replace("«u»", positions[position].replaceAll("«x»", written))}\nfor (let i = 0; i < 2; i++) console.log(f(1, 2), f(), f(3));\n`,
  };
}

export const membersThatLeave: Record<string, { define: string; member: string; question: string }> = {
  "a method": { define: 'F.prototype.x = function () { return "old"; };', member: "«a» return super.x();", question: "attempt(() => new K().go())" },
  "a getter": { define: 'Object.defineProperty(F.prototype, "x", { get() { return "old"; }, configurable: true });', member: "«a» return super.x;", question: "attempt(() => new K().go())" },
  "a setter": { define: 'Object.defineProperty(F.prototype, "x", { set(v) { log.push("old" + v); }, configurable: true });', member: "«a» super.x = 1; return Object.keys(this).join() + log.join();", question: "attempt(() => new K().go())" },
};

export const departures: Record<string, string> = {
  "delete": "delete F.prototype.x;",
  "Reflect.deleteProperty": 'Reflect.deleteProperty(F.prototype, "x");',
  "a delete under a computed key": 'delete F.prototype[["x"].join("")];',
  "another member in its place": 'Object.defineProperty(F.prototype, "x", { value: () => "other", writable: true, configurable: true });',
};

/** «c» is the change, «d» defines the class below, «q» is the question. */
export const momentsOfDeparture: Record<string, string> = {
  "before the class is defined": "«c»\n«d»",
  "after the class is defined": "«d»\n«c»",
  "after the first question": "«d»\nconsole.log(«q»);\n«c»",
};

export const otherQuestions: Record<string, string> = {
  "nothing else": "",
  "Reflect.get": 'Reflect.get(this, "x");',
  "a helper around Reflect.get": 'read(this, "x");',
  "Reflect.has": 'Reflect.has(this, "x");',
  "in": '"x" in this;',
  "a computed key": 'this[["x"].join("")];',
};

export const livesOfParent: Record<string, [string, string]> = {
  "makes no object": ["", ""],
  "has made an object": ["new F();", ""],
  "makes an object afterwards": ["", "new F();"],
};

export function memberLeaves(member: string, departure: string, moment: string, otherQuestion: string, life: string) {
  const { define, member: body, question } = membersThatLeave[member];
  const [before, after] = livesOfParent[life];
  const steps = momentsOfDeparture[moment]
    .replace("«c»", departures[departure])
    .replace("«d»", `class K extends F { go() { ${body.replace("«a»", otherQuestions[otherQuestion])} } }`)
    .replace("«q»", question);
  return {
    file: "main.js",
    text: `${attempt}const log = [];\nconst read = (o, k) => Reflect.get(o, k);\nfunction F() { this.a = 1; }\n${define}\n${before}\n${steps}\n${after}\nfor (let i = 0; i < 2; i++) console.log(${question});\n`,
  };
}

/** «f» is the callee, «l» the list. */
export const listTakers: Record<string, string> = {
  "Reflect.construct": "Reflect.construct(«f», «l»)",
  "Reflect.construct with new.target": "Reflect.construct(«f», «l», «f»)",
  "Reflect.apply": "Reflect.apply(«f», null, «l»)",
  "apply": "«f».apply(null, «l»)",
};

export const takenBy: Record<string, string> = { "a class": "Point", "a function": "Plain", "a built-in": "Array" };

export const handedLists: Record<string, string> = {
  "undefined": "undefined",
  "null": "null",
  "a variable that holds nothing": "nothing",
  "a member that is not there": "options.list",
  "a parameter that is undefined": "handed(undefined)",
  "a parameter that is null": "handed(null)",
  "a number": "1",
  "a string": '"ab"',
  "a list": "[1, 2]",
  "an object with a length": "{ length: 1, 0: 7 }",
  "a typed array": "new Uint8Array([4, 5])",
};

export function listIsHanded(taker: string, callee: string, list: string, usesResult: boolean) {
  const handsOn = handedLists[list].startsWith("handed(");
  const call = listTakers[taker].replaceAll("«f»", takenBy[callee]).replace("«l»", handsOn ? "list" : handedLists[list]);
  const body = usesResult ? `return JSON.stringify(${call});` : `${call}; return "done";`;
  const question = handsOn ? `attempt(() => (list => { ${body} })(${handedLists[list].slice(7, -1)}))` : `attempt(() => { ${body} })`;
  return {
    file: "main.js",
    text: `${attempt}class Point { constructor(x = 0) { this.x = x; } }\nfunction Plain(x) { if (this) this.x = x; return undefined; }\nlet nothing;\nconst options = {};\nfor (let i = 0; i < 2; i++) console.log(${question});\n`,
  };
}
