// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// A function that is constructed makes no tail call, so its frame is found, whoever its last call calls: here Reflect.construct and Error arrive as values.
// A function that is called, in strict code, leaves by a tail call: its frame is gone, no frame is left, and the error has no stack.
const unseen = (x: any): any => [x][JSON.parse("0")];
const construct = unseen(Reflect.construct), E = unseen(Error);
let seen: any = null;
function Target(this: any, text: string): any { return construct(E, [text], new.target); }
function TargetOrItself(this: any, text: string): any { return construct(E, [text], new.target ?? TargetOrItself); }
function Held(this: any, text: string): any { const made = construct(E, [text], new.target ?? Held); return made; }
function Itself(this: any, text: string): any { return construct(E, [text], Itself); }
function ReadsTarget(this: any, text: string): any { seen = new.target; return construct(E, [text], ReadsTarget); }
function OutOfSight(this: any, text: string): any { return construct(E, [text], unseen(new.target ?? OutOfSight)); }
function NamedError(this: any, text: string): any { return construct(Error, [text], new.target ?? NamedError); }
function Named(this: any, text: string): any { return Reflect.construct(Error, [text], new.target ?? Named); }
function NotLast(this: any, text: string): any { const made = construct(E, [text], new.target ?? NotLast); seen = made; return made; }
function Handled(this: any, text: string): any { try { return construct(E, [text], new.target ?? Handled); } finally { seen = 1; } }
function make(build: any, kind: any, text: string, target: any): any { return build(kind, [text], target); }
function Deeper(this: any, text: string): any { return make(construct, E, text, new.target ?? Deeper); }
const all: [string, any][] = [["Target", Target], ["TargetOrItself", TargetOrItself], ["Held", Held], ["Itself", Itself], ["ReadsTarget", ReadsTarget], ["OutOfSight", OutOfSight],
  ["NamedError", NamedError], ["Named", Named], ["NotLast", NotLast], ["Handled", Handled], ["Deeper", Deeper]];
for (const [, f] of all) f.prototype = Object.create(Error.prototype);
for (const [name, f] of all) {
  const known = new f("a"), hidden = new (unseen(f))("b");
  console.log(name, "| constructed:", typeof known.stack, known instanceof f, known.message, "| out of sight:", typeof hidden.stack, hidden instanceof f, hidden.message);
}
for (const [name, f] of all) {
  if (name === "Target") continue;
  const called = f("c");
  console.log(name, "| called:", typeof called.stack, called instanceof f, called.message);
}
