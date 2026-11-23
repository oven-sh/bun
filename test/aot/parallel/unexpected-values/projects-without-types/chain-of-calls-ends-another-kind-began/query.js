export class Query {
  constructor(items) {
    this.items = items;
  }
  where(test) {
    return new Query(this.items.filter(test));
  }
  take(count) {
    this.items = this.items.slice(0, count);
    return this;
  }
  pluck(name) {
    return new Query(this.items.map(item => item[name]));
  }
  first() {
    return this.items[0];
  }
  count() {
    return this.items.length;
  }
  sum() {
    return this.items.reduce((sum, item) => sum + item, 0);
  }
  orNothing() {
    return this.items.length ? this : null;
  }
  unwrap() {
    return this.items;
  }
  valueOf() {
    return this.items.length;
  }
}
export const from = items => new Query(items);
