// One function reads and writes objects of a written type that the program's own literals make and that a parser makes of texts with other kinds of values, fewer members and more: every read finds what is there.
// Under: --aot-testing=CheckProofsAtRunTime: the types and the filling of the fields of a layout that a literal makes and a parser makes too
type Account = { id: number; owner: string; limit?: number };
function make(id: number, owner: string): Account { return { id, owner }; }
function load(text: string) { return JSON.parse(text) as Account; }
function describe(account: Account) { return typeof account.id + ":" + account.id + " " + typeof account.owner + ":" + account.owner + " " + typeof account.limit + ":" + account.limit; }
function raise(account: Account) { account.limit = (account.limit ?? 0) + 1; account.id++; return account; }
const accounts: Account[] = [];
for (let i = 0; i < 5; i++) accounts.push(make(i, "own" + i));
const texts = ['{"id":10,"owner":"parsed"}', '{"id":11,"owner":"parsed","limit":5}', '{"id":"12","owner":13}', '{"owner":"no id"}', '{"id":14}', '{"id":null,"owner":null,"limit":null}', '{"id":1.5,"owner":"","limit":-0}', '{"limit":"text","owner":{"a":1},"id":[1]}', '{"id":15,"owner":"more","other":true}'];
for (let round = 0; round < 3; round++) {
  for (const text of texts) accounts.push(load(text));
}
for (const account of accounts) console.log(describe(account));
for (const account of accounts) console.log(describe(raise(account)), JSON.stringify(account));
