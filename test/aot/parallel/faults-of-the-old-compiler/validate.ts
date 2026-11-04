interface Rule { name: string; limit: unknown }
interface Result { valid: boolean; errors: string[]; values: number[] }
function validate(rules: Rule[]): Result {
  const errors: string[] = [];
  const got = rules.map(r => { if (typeof r.limit !== "number") { errors.push(r.name); return 0; } return r.limit; });
  return { valid: errors.length === 0, errors, values: got.filter(x => x > 1) };
}
function look(r: Result): string { return (r.valid ? "valid" : "invalid") + (r.errors.length === 1 ? " one" : " none") + (r.values.length === 2 ? " two" : " other"); }
const rules: Rule[] = [{ name: "first", limit: 7 }, JSON.parse('{"name":"second","limit":"x"}'), { name: "third", limit: 14 }];
setTimeout(() => { console.log(look(validate(rules))); }, 0);
export {};
