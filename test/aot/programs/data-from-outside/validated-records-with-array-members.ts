// validate<T>(value) and JSON.parse<T>(text) for a record with an array member. The array of the result is a copy that holds what was validated, a wrong element is reported with its path, and a getter that runs during the validation, or a toJSON after it, reaches the array of the caller and never the copy before it is handed out.
// STATISTIC: ValidatorsCreated >= 3
// STATISTIC: ParsersCreated >= 3
import { validate } from "bun:bundle";
import type { Schema } from "bun";
type Row = { id: number };
type Page = { items: Row[]; total: number };

function read(page: Page): string {
  let sum = 0;
  for (const row of page.items) sum += row.id;
  for (let at = 0; at < page.items.length; at++) sum += page.items[at]!.id * 100;
  return "total " + page.total + ", " + page.items.length + " rows, sum " + sum + ", ids [" + page.items.map(row => row.id).join() + "]";
}

function attempt(what: string, run: () => string): void {
  try {
    console.log(what + ":", run());
  } catch (error) {
    const issues = (error as Partial<Schema.Error>).issues;
    console.log(what + ": threw", (error as Error).name, issues ? issues.map(issue => issue.path.join(".") + " " + issue.code).join("; ") : "without issues");
  }
}

const given = { items: [{ id: 1 }, { id: 2 }], total: 2 };
const validated = validate<Page>(given);
console.log(read(validated), JSON.stringify(validated), validated.items !== given.items, validated.items[0] !== given.items[0], JSON.stringify(given));
const parsed = JSON.parse<Page>('{"items":[{"id":3},{"id":4},{"id":5}],"total":3}');
console.log(read(parsed), JSON.stringify(parsed));
console.log(read(validate<Page>(parsed)));
console.log(read(validate<Page>({ items: [], total: 0 })));
console.log(read(JSON.parse<Page>('{ "total" : 0 , "items" : [ ] }')));

attempt("a wrong element", () => read(validate<Page>({ items: [{ id: 1 }, { id: "two" }], total: 2 })));
attempt("two wrong elements", () => read(validate<Page>({ items: [{ id: null }, { id: 2 }, 5], total: 3 })));
attempt("no array", () => read(validate<Page>({ items: "none", total: 0 })));
attempt("a wrong element in a text", () => read(JSON.parse<Page>('{"items":[{"id":1},{"id":"two"}],"total":2}')));
attempt("two wrong elements in a text", () => read(JSON.parse<Page>('{"items":[{"id":null},{"id":2},5],"total":3}')));
attempt("no array in a text", () => read(JSON.parse<Page>('{"items":"none","total":0}')));
attempt("a text that ends early", () => read(JSON.parse<Page>('{"items":[{"id":1}')));

function changedByGetter(change: (items: any) => void): string {
  const items: Row[] = [{ id: 1 }, { id: 2 }];
  const page = validate<Page>({
    items,
    get total() {
      change(items);
      return 2;
    },
  });
  return read(page) + ", " + (page.items !== items) + " " + Array.isArray(page.items) + " " + Object.isFrozen(page.items) + " " + (Object.getPrototypeOf(page.items) === Array.prototype);
}
attempt("a getter adds a row", () => changedByGetter(items => (items[2] = { id: 3 })));
attempt("a getter adds a wrong row", () => changedByGetter(items => (items[2] = { id: "three" })));
attempt("a getter names a property", () => changedByGetter(items => (items.named = true)));
attempt("a getter freezes", () => changedByGetter(items => Object.freeze(items)));
attempt("a getter replaces a row", () => changedByGetter(items => (items[0] = { id: 10 })));

const lengthsSeen: number[] = [];
const withToJSON = validate<Page>({
  items: [{ id: 1 }],
  total: 1,
  toJSON(this: Page) {
    lengthsSeen.push(this.items.length);
    this.items.push({ id: this.items.length + 1 });
    return { rows: this.items.length };
  },
});
console.log(lengthsSeen.length, read(withToJSON));
console.log(JSON.stringify(withToJSON), JSON.stringify(withToJSON), lengthsSeen.join(), read(withToJSON));
