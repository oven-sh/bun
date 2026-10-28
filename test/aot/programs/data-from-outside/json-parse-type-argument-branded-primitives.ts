// A branded primitive, `string & { readonly __brand: "UserId" }`, is parsed as the primitive: no value has the brand at run time.
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
    return String(error);
  }
}
const texts = [
  '{"id":"u1","balance":250,"level":"low","home":"/u1","note":"","friends":["u2","u3"]}',
  '{"id":"u1","balance":250,"level":"high","note":"n","friends":[]}',
  '{"id":1,"balance":"250","level":"middle","home":"u1","note":null,"friends":["u2",3]}',
  '{"id":{"__brand":"UserId"},"balance":1,"level":"low","note":"","friends":[]}',
];
for (const text of texts) console.log(describe(() => JSON.parse(text) as Account));
console.log(describe(() => JSON.parse('"u9"') as UserId), describe(() => JSON.parse("9") as UserId), describe(() => JSON.parse("1.5") as Cents), describe(() => JSON.parse('"high"') as Level), describe(() => JSON.parse('"none"') as Level));
const account = JSON.parse(texts[0]) as Account;
const shout = (id: UserId): string => id.toUpperCase() + account.friends.length;
console.log(shout(account.id), account.balance + 1, account.level.length, account.home?.slice(1));
