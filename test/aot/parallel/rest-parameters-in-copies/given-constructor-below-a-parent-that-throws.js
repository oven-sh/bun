class Throws { constructor(limit) { if (limit > 1) throw new RangeError("over " + limit); this.limit = limit; } }
class Given extends Throws { field = (() => { ran++; return 1; })(); }
let ran = 0;
for (let i = 0; i < 4; i++) {
  try { console.log(new Given(i).limit, ran); } catch (error) { console.log(error.constructor.name, error.message, ran); }
}
