class Query {
  constructor(items) {
    this.items = items;
  }
  size() {
    return this.items.length;
  }
}
function query(...items) {
  return new Query(items);
}
query.fn = query.prototype = Query.prototype;
query.fn.first = function () {
  return this.items[0];
};

class Other {
  size() {
    return -1;
  }
}
function made(x) {
  if (this instanceof made) this.items = [x];
}
made.prototype = Other.prototype;

const arrow = () => 3;
arrow.prototype = Query.prototype;

function assigned() {}
Object.assign(assigned, { prototype: Other.prototype, version: 1 });

function call(f) {
  try {
    return String(f());
  } catch (e) {
    return e.constructor.name;
  }
}
for (let round = 0; round < 3; round++) {
  const q = query(1, 2, 3);
  console.log(q.size(), q.first(), q instanceof query, q instanceof Query, Object.keys(query).join(), query.prototype === Query.prototype);
  console.log(call(() => new query(4).size()), call(() => Reflect.construct(Query, [[5]], query).first()));
  const m = new made(round);
  console.log(m.size(), m.items, m instanceof made, m instanceof Other, Object.getPrototypeOf(m) === Other.prototype, m.constructor.name);
  console.log(call(() => new arrow()), call(() => q instanceof arrow), call(() => new assigned().size()), call(() => new assigned() instanceof Other), assigned.version);
  console.log(call(() => new (class extends query {})(6) instanceof Query), call(() => new (query.bind(null))(7).size()));
  if (round === 0) {
    Other.prototype.size = () => "replaced";
    query.prototype.plugin = function () {
      return "plugin of " + this.items;
    };
  }
  if (round === 1) query.prototype = Other.prototype;
  console.log(call(() => q.plugin()), call(() => new query(8).size()), query.prototype === Other.prototype, q instanceof query);
}
