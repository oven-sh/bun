// A branded primitive, `string & { readonly __brand: "UserId" }`, is validated as the primitive: no value has the brand at run time.
type UserId = string & { readonly __brand: "UserId" };
type Cents = number & { readonly __brand: "Cents" };
type Level = ("low" | "high") & { readonly __level: true };
type Path = `/${string}` & { readonly __brand: "Path" };
type Loose = string & {};
interface Account { id: UserId; balance: Cents; level: Level; home?: Path; note: Loose; friends: UserId[] }
function describe(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    const issues = (error as { issues?: { path: (string | number)[]; code: string; expected: string }[] }).issues;
    return issues ? issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected).join("; ") : String(error);
  }
}
const texts = [
  '{"id":"u1","balance":250,"level":"low","home":"/u1","note":"","friends":["u2","u3"]}',
  '{"id":"u1","balance":250,"level":"high","note":"n","friends":[]}',
  '{"id":1,"balance":"250","level":"middle","home":"u1","note":null,"friends":["u2",3]}',
  '{"id":{"__brand":"UserId"},"balance":1,"level":"low","note":"","friends":[]}',
];
for (const text of texts) console.log(describe(() => JSON.parse<Account>(text)));
console.log(describe(() => JSON.parse<UserId>('"u9"')), describe(() => JSON.parse<UserId>("9")), describe(() => JSON.parse<Cents>("1.5")), describe(() => JSON.parse<Level>('"high"')), describe(() => JSON.parse<Level>('"none"')));
const account = JSON.parse<Account>(texts[0]);
const shout = (id: UserId): string => id.toUpperCase() + account.friends.length;
console.log(shout(account.id), account.balance + 1, account.level.length, account.home?.slice(1));
