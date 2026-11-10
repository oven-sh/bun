// Guards: on an older object too a private field belongs to the evaluation that laid it, in whichever order two evaluations came.
class Hands { constructor(back) { return back; } }
const make = () => class extends Hands { #kept; constructor(on, kept) { super(on); this.#kept = kept; } };
const [First, Second] = [make(), make()];
const lay = (kept, ...classes) => { const older = JSON.parse('{"shown":1}'); for (const Class of classes) new Class(older, kept); return older; };
console.log(Bun.deepMatch(lay(1, First), lay(1, First)), Bun.deepMatch(lay(1, First), lay(2, First)), Bun.deepMatch(lay(1, First), lay(1, Second)), Bun.deepMatch(lay(1, First, Second), lay(1, Second, First)), Bun.deepMatch(lay(1, First), lay(1, Second, First)), Bun.deepMatch(lay(1, First, Second), lay(1, First)), Bun.deepMatch(lay(1, First), { shown: 1 }), Bun.deepMatch({ shown: 1 }, lay(1, First)));
