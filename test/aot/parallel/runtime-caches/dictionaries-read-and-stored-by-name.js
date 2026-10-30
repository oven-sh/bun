// An object in dictionary mode is read and stored by name while names are added, deleted, replaced and redefined under it, before and after it was flattened once.
const trips = JSON.parse("50");
const names = JSON.parse('["shared", "other"]');

function read(o, n) { let last; for (let i = 0; i < n; i++) last = o.shared; return last; }
function store(o, n) { for (let i = 0; i < n; i++) o.shared = i; return o[names[0]]; }
function storeInStrictCode(o, n) { "use strict"; let thrown = 0; for (let i = 0; i < n; i++) { try { o.shared = i; } catch { thrown++; } } return thrown; }
function fill(o, from, to) { for (let i = from; i < to; i++) o["k" + i] = i; }
function drop(o, from, to) { for (let i = from; i < to; i++) delete o["k" + i]; }

function exercise(what, o) {
  const said = [];
  said.push(read(o, trips));
  o[names[0]] = "replaced";
  said.push(read(o, trips));
  said.push(store(o, trips));
  said.push(read(o, trips));
  fill(o, 1000, 1010);
  said.push(read(o, trips));
  delete o[names[0]];
  said.push(read(o, trips));
  o[names[0]] = "added";
  said.push(read(o, trips));
  drop(o, 1000, 1005);
  fill(o, 2000, 2005);
  said.push(read(o, trips));
  Object.defineProperty(o, names[0], { get() { return "getter"; }, set(value) { this.seen = value; }, configurable: true });
  said.push(read(o, trips));
  said.push(store(o, trips), o.seen);
  Object.defineProperty(o, names[0], { value: "read-only", writable: false, configurable: true });
  said.push(read(o, trips), storeInStrictCode(o, trips), read(o, trips));
  delete o[names[0]];
  Object.setPrototypeOf(o, { shared: "inherited" });
  said.push(read(o, trips));
  Object.getPrototypeOf(o).shared = "inherited, replaced";
  said.push(read(o, trips));
  said.push(store(o, trips), Object.getPrototypeOf(o).shared);
  console.log(what + ": " + said.join(" | "));
}

function exerciseEach(kind, create, createEmpty) {
  const bySize = create();
  fill(bySize, 0, 200);
  exercise(kind + ", dictionary by size", bySize);

  const byDeletion = create();
  fill(byDeletion, 0, 200);
  drop(byDeletion, 0, 150);
  exercise(kind + ", dictionary by deletion", byDeletion);

  const again = create();
  fill(again, 0, 200);
  drop(again, 0, 150);
  read(again, trips);
  fill(again, 200, 400);
  exercise(kind + ", dictionary again after it was flattened", again);

  const againByDeletion = create();
  fill(againByDeletion, 0, 200);
  drop(againByDeletion, 0, 150);
  read(againByDeletion, trips);
  fill(againByDeletion, 200, 400);
  drop(againByDeletion, 200, 300);
  exercise(kind + ", dictionary by deletion after it was flattened", againByDeletion);

  const withoutName = createEmpty();
  fill(withoutName, 0, 200);
  drop(withoutName, 0, 150);
  read(withoutName, trips);
  fill(withoutName, 200, 400);
  exercise(kind + ", the name is absent at first", withoutName);
}

exerciseEach("parsed", () => JSON.parse('{"shared":"first"}'), () => JSON.parse("{}"));
exerciseEach("literal", () => ({ shared: "first" }), () => ({}));
exerciseEach("no prototype", () => { const o = Object.create(null); o.shared = "first"; return o; }, () => Object.create(null));
