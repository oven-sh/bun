// Text that is a T is read once by `JSON.parse(text) as T`, whatever the order of its members, its white space, the members that T does not declare and the members that come again, and so is text whose values are not those of T: the engine's parser is for text that is no JSON and for an escape in a key.
// IR+ ^ .*JSONStartsWith
declare const aotOperationCount: undefined | ((name: string) => number);
interface Item { sku: string; quantity: number; note?: string }
interface Order { id: number; items: Item[]; to: { name: string; city: string }; kind: "gift" | "plain"; coupon: string | null }

const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const opened = () => (counted ? counted("operationAOTJSONSourceOpen") : 0);
const readAgain = () => (counted ? counted("operationAOTJSONSourceAbandon") : 0);
function count(what: string, texts: string[], againExpected: number): void {
  const [openedBefore, againBefore] = [opened(), readAgain()];
  let sum = 0;
  for (const text of texts) {
    try {
      sum += (JSON.parse(text) as Order).items.length;
    } catch {
      sum += 100;
    }
  }
  console.log(what, sum, counted ? opened() - openedBefore === texts.length && readAgain() - againBefore === againExpected : true);
}
const order = { id: 7, items: [{ sku: "a", quantity: 1 }, { sku: "b", quantity: 2, note: "n" }], to: { name: "n", city: "c" }, kind: "gift", coupon: null };
const turned = { coupon: "c", kind: "plain", to: { city: "c", name: "n" }, items: [{ note: "n", quantity: 2, sku: "b" }], id: 7 };
count("as JSON.stringify writes it", [JSON.stringify(order), JSON.stringify(turned)], 0);
count("indented", [JSON.stringify(order, null, 2), JSON.stringify(order, null, "\t"), JSON.stringify(turned, null, 8)], 0);
count("with unknown members", [JSON.stringify({ first: [1, { a: "b" }], ...order, last: null })], 0);
count("with a member written twice", ['{"id":6,"id":7,"items":[],"to":{"name":"n","city":"c"},"kind":"gift","coupon":null}'], 0);
count("with members written again further on", ['{"id":6,"items":[],"id":7,"to":{"name":"m","city":"c"},"kind":"gift","more":1,"to":{"name":"n","city":"c"},"coupon":null,"kind":"plain","id":8}'], 0);
count("with escapes in strings", ['{"id":7,"items":[{"sku":"\\u0061\\n","quantity":1}],"to":{"name":"\\"","city":"c"},"kind":"gift","coupon":null}'], 0);
count("16 bits", [JSON.stringify({ ...order, coupon: "Ā" })], 0);
count("with an escape in a key", ['{"\\u0069d":7,"items":[],"to":{"name":"n","city":"c"},"kind":"gift","coupon":null}'], 1);
count("what is no T", [JSON.stringify({ ...order, id: "7" }), JSON.stringify({ ...order, kind: "other" }), JSON.stringify({ ...order, items: [{ sku: "a", quantity: 1, note: null }] })], 0);
count("what is no JSON", ["{", ""], 2);
for (const text of ['{"id":6,"items":[],"id":7,"to":{"name":"m","city":"c"},"kind":"gift","more":1,"to":{"name":"n","city":"c"},"coupon":null,"kind":"plain","id":8}', '{"coupon":null,"coupon":"c","id":1,"kind":"gift","items":[],"to":{"city":"c","name":"n","city":"d"}}']) {
  const parsed = JSON.parse(text) as Order;
  console.log(Object.keys(parsed).join(), Object.keys(parsed.to).join(), JSON.stringify(parsed));
}
