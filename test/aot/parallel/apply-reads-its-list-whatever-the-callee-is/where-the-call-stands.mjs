// Where the call stands and how it is spelled: at the top of the module, in an arrow function, a method, an async function, a generator, a getter, a class's static block; with ?., with a computed name, by a name of its own.
let reads = 0;
const fake = Object.create(Function.prototype);
const like = () => ({ get length() { reads++; return 0; } });
const list = () => { const made = [1, 2]; Object.defineProperty(made, 0, { get() { reads++; return 1; } }); return made; };
const say = (label, deed) => {
  reads = 0;
  let last;
  try { last = String(deed()); } catch (error) { last = error instanceof TypeError ? "TypeError" : "another"; }
  console.log(label, last, reads);
};
reads = 0;
try { fake.apply(null, like()); } catch { console.log("top like", reads); }
reads = 0;
try { fake.apply(null, list()); } catch { console.log("top list", reads); }
for (const [name, make] of [["like", like], ["list", list]]) {
  say("arrow " + name, () => fake.apply(null, make()));
  say("arrow, unknown callee " + name, () => [fake][0].apply(null, make()));
  say("method " + name, () => ({ run(callee) { return callee.apply(this, make()); } }).run(fake));
  say("optional receiver " + name, () => fake?.apply(null, make()));
  say("optional call " + name, () => fake.apply?.(null, make()));
  say("computed name " + name, () => fake["apply"](null, make()));
  say("computed name out of a variable " + name, () => { const key = ["apply"][0]; return fake[key](null, make()); });
  say("a name of its own " + name, () => { const apply = fake.apply; return apply.call(fake, null, make()); });
  say("Reflect.apply " + name, () => Reflect.apply(fake, null, make()));
  say("getter " + name, () => ({ get answer() { return fake.apply(null, make()); } }).answer);
  say("static block " + name, () => { class Holder { static answer; static { Holder.answer = fake.apply(null, make()); } } return Holder.answer; });
  say("generator " + name, () => (function* () { yield fake.apply(null, make()); })().next().value);
  say("new.target " + name, () => new (function () { return fake.apply(this, make()); })());
  say("a number " + name, () => { const callee = [5][0]; return callee.apply(null, make()); });
  say("call with a spread " + name, () => fake.call(null, ...make()));
}
reads = 0;
await (async () => { try { await fake.apply(null, like()); } catch { console.log("async like", reads); } })();
reads = 0;
await (async () => { try { return await fake.apply(null, list()); } catch { console.log("async list", reads); } })();
