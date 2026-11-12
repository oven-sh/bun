// Methods that return this, a copy at each step, and one end
class Query {
  constructor(parts = {}) {
    this.parts = parts;
  }
  with(more) {
    return new Query({ ...this.parts, ...more });
  }
  from(table) {
    return this.with({ table });
  }
  where(key, value) {
    return this.with({ where: [...(this.parts.where ?? []), key + "=" + value] });
  }
  limit(n) {
    return n ? this.with({ limit: n }) : this;
  }
  toString() {
    const { table, where = [], limit } = this.parts;
    return "from " + table + (where.length ? " where " + where.join(" and ") : "") + (limit === undefined ? "" : " limit " + limit);
  }
}
function build(table, n) {
  const base = new Query().from(table);
  const one = base.where("id", n);
  const two = one.where("x", n * 2).limit(n);
  return [base, one, two].join(" ; ") + " " + (base.limit(0) === base);
}
console.log(build("a", 1));
console.log(build("users", 25));
console.log(build("t", 0));
