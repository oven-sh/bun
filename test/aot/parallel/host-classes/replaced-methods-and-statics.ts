// A method or a static of a web interface is called many times, then replaced by a value, stored to, made an accessor, put back and deleted, each time under a name that the build cannot read: each call answers as plain Bun does. A locked prototype refuses each change to what it has, and every call goes on answering.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}

const bytes = new Uint8Array([97, 98]);
const decoder = new TextDecoder();
const response = new Response("body");
const statusOf = (made: unknown): unknown => (made instanceof Response ? made.status : made);
const decodeOf = (holder: TextDecoder): unknown => holder.decode(bytes);
const uuidOf = (holder: Crypto): unknown => holder.randomUUID().length;
const jsonOf = (): unknown => statusOf(Response.json({ a: 1 }));
const redirectOf = (): unknown => statusOf(Response.redirect("http://example.com/"));
const cloneOf = (holder: Response): unknown => statusOf(holder.clone());
const loose = (value: unknown): any => value;

function all(label: string, holder: object, name: string, typed: () => unknown, untyped: () => unknown) {
  const original = Object.getOwnPropertyDescriptor(holder, name)!;
  const both = () => [typed(), untyped()];
  const many = () => {
    let same = 0;
    const first = JSON.stringify(both());
    for (let turn = 0; turn < 200; turn++) if (JSON.stringify(both()) === first) same++;
    return [first, same];
  };
  say(label + " has a descriptor that may be redefined", () => [original.configurable, typeof original.value]);
  say(label + " called many times", many);
  say(label + " replaced by a value", () => (Object.defineProperty(holder, name, { value: () => "replaced", writable: true, configurable: true }), both()));
  say(label + " stored to", () => (((holder as Record<string, unknown>)[name] = () => "stored"), both()));
  say(label + " replaced by a getter", () => (Object.defineProperty(holder, name, { get: () => () => "from a getter", configurable: true }), both()));
  say(label + " put back", () => (Object.defineProperty(holder, name, original), both()));
  say(label + " deleted", () => [delete (holder as Record<string, unknown>)[name], name in holder]);
  say(label + " put back again", () => (Object.defineProperty(holder, name, original), many()));
}

all("TextDecoder.prototype.decode", TextDecoder.prototype, "decode", () => decodeOf(decoder), () => loose(decoder).decode(bytes));
all("Crypto.prototype.randomUUID", Crypto.prototype, "randomUUID", () => uuidOf(crypto), () => loose(loose(crypto).randomUUID()).length);
all("Response.json", Response, "json", jsonOf, () => statusOf(loose(Response).json({ a: 1 })));
all("Response.redirect", Response, "redirect", redirectOf, () => statusOf(loose(Response).redirect("http://example.com/")));
all("Response.prototype.clone", Response.prototype, "clone", () => cloneOf(response), () => statusOf(loose(response).clone()));
console.log(lines.join("\n"));
/* Output:
TextDecoder.prototype.decode has a descriptor that may be redefined: [true,"function"]
TextDecoder.prototype.decode called many times: ["[\"ab\",\"ab\"]",200]
TextDecoder.prototype.decode replaced by a value: ["replaced","replaced"]
TextDecoder.prototype.decode stored to: ["stored","stored"]
TextDecoder.prototype.decode replaced by a getter: ["from a getter","from a getter"]
TextDecoder.prototype.decode put back: ["ab","ab"]
TextDecoder.prototype.decode deleted: [true,false]
TextDecoder.prototype.decode put back again: ["[\"ab\",\"ab\"]",200]
Crypto.prototype.randomUUID has a descriptor that may be redefined: [true,"function"]
Crypto.prototype.randomUUID called many times: ["[36,36]",200]
Crypto.prototype.randomUUID replaced by a value: [8,8]
Crypto.prototype.randomUUID stored to: [6,6]
Crypto.prototype.randomUUID replaced by a getter: [13,13]
Crypto.prototype.randomUUID put back: [36,36]
Crypto.prototype.randomUUID deleted: [true,false]
Crypto.prototype.randomUUID put back again: ["[36,36]",200]
Response.json has a descriptor that may be redefined: [true,"function"]
Response.json called many times: ["[200,200]",200]
Response.json replaced by a value: ["replaced","replaced"]
Response.json stored to: ["stored","stored"]
Response.json replaced by a getter: ["from a getter","from a getter"]
Response.json put back: [200,200]
Response.json deleted: [true,false]
Response.json put back again: ["[200,200]",200]
Response.redirect has a descriptor that may be redefined: [true,"function"]
Response.redirect called many times: ["[302,302]",200]
Response.redirect replaced by a value: ["replaced","replaced"]
Response.redirect stored to: ["stored","stored"]
Response.redirect replaced by a getter: ["from a getter","from a getter"]
Response.redirect put back: [302,302]
Response.redirect deleted: [true,false]
Response.redirect put back again: ["[302,302]",200]
Response.prototype.clone has a descriptor that may be redefined: [true,"function"]
Response.prototype.clone called many times: ["[200,200]",200]
Response.prototype.clone replaced by a value: throws TypeError: Cannot assign to Response.prototype.clone because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.prototype.clone stored to: throws TypeError: Cannot assign to Response.prototype.clone because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.prototype.clone replaced by a getter: throws TypeError: Cannot assign to Response.prototype.clone because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.prototype.clone put back: [200,200]
Response.prototype.clone deleted: throws TypeError: Cannot delete Response.prototype.clone because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.prototype.clone put back again: ["[200,200]",200]
*/
