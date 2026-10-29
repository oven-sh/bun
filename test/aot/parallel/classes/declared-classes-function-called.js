// With declared functions: Classes out of a function are called without new: the frames of the error.
const frames = (error) => error.stack.split("\n").slice(0, 5).map((l) => l.trim().replace(/\(?[^ ()]*[\\/]([^\\/:]+):(\d+):(\d+)\)?/, "$1:$2:$3")).join(" | ");
class Base { constructor(fail) { } }
function WithField(Parent) { return class extends Parent { field = 1; constructor(fail) { super(fail); } }; }
function WithPrivate(Parent) { return class extends Parent { #p() { } constructor(fail) { super(fail); } }; }
function WithThrow(Parent) { return class extends Parent { constructor(fail) { super(fail); if (fail === "own") throw new Error("in own"); } }; }
function Bare(Parent) { return class extends Parent { constructor(fail) { super(fail); } }; }
const F1 = WithField(Base), F2 = WithPrivate(Base), F3 = WithThrow(Base), F4 = Bare(Base);
class A extends Bare(Base) { } const F5 = Bare(Base);
const tries = [() => F1(), () => F2(), () => F3(), () => F4(), () => F5(), () => new F5(), () => new F3("own")];
for (const t of tries) { try { t(); console.log("no throw"); } catch (error) { console.log(frames(error)); } }
