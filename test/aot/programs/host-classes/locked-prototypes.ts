// --aot locks the prototypes of Request, Response, Blob, Headers, URL and URLSearchParams: every way to change them is refused, and the attributes of their members read as in plain Bun. Buffer.prototype keeps its members, its prototype and its missing index keys, and takes other names and the program's own symbols. The constructors and global names of the six classes and the prototypes of other host classes stay as in plain Bun.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = String(work());
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}

type Row = [name: string, constructor: Function, method: string, getter: string];
const locked: Row[] = [
  ["Request", Request, "text", "url"],
  ["Response", Response, "json", "status"],
  ["Blob", Blob, "slice", "size"],
  ["Headers", Headers, "get", "count"],
  ["URL", URL, "toJSON", "pathname"],
  ["URLSearchParams", URLSearchParams, "get", "size"],
];
const unlocked: Row[] = [
  ["AbortSignal", AbortSignal, "throwIfAborted", "aborted"],
  ["ReadableStream", ReadableStream, "getReader", "locked"],
  ["TextEncoder", TextEncoder, "encode", "encoding"],
  ["TextDecoder", TextDecoder, "decode", "encoding"],
  ["FormData", FormData, "get", "get"],
  ["EventTarget", EventTarget, "addEventListener", "addEventListener"],
];
const membersFixed: Row[] = [["Buffer", Buffer, "readInt8", "parent"]];

for (const [name, constructor, method, getter] of [...locked, ...unlocked, ...membersFixed]) {
  const prototype = constructor.prototype as Record<PropertyKey, unknown>;
  const before = prototype[method];
  const keysBefore = Reflect.ownKeys(prototype).map(String).join();
  const at = name + ".prototype";
  say(`${at}.${method} = f`, () => ((prototype[method] = function replaced() {}), prototype[method] === before ? "unchanged" : "replaced"));
  try {
    prototype[method] = before;
  } catch {}
  say(`${at}.${method} = the same function`, () => ((prototype[method] = before), "allowed"));
  say(`Object.defineProperty(${at}, "${method}", value)`, () => (Object.defineProperty(prototype, method, { value: before, writable: true, configurable: true, enumerable: true }), "defined"));
  say(`Object.defineProperty(${at}, "${getter}", getter)`, () => {
    const old = Object.getOwnPropertyDescriptor(prototype, getter)!;
    Object.defineProperty(prototype, getter, { get: () => "replaced", configurable: true });
    Object.defineProperty(prototype, getter, old);
    return "replaced and restored";
  });
  say(`${at}.added = 1`, () => ((prototype.added = 1), delete prototype.added, "added and deleted"));
  say(`${at}[0] = 1`, () => ((prototype[0] = 1), delete prototype[0], "added and deleted"));
  say(`${at}[Symbol.for("added")] = 1`, () => ((prototype[Symbol.for("added")] = 1), delete prototype[Symbol.for("added")], "added and deleted"));
  say(`Object.defineProperty(${at}, "added", value)`, () => (Object.defineProperty(prototype, "added", { value: 1, configurable: true }), delete prototype.added, "added and deleted"));
  say(`Object.assign(${at}, { added: 1 })`, () => (Object.assign(prototype, { added: 1 }), delete prototype.added, "added and deleted"));
  say(`${at}.__defineGetter__("added", f)`, () => ((prototype as any).__defineGetter__("added", () => 1), delete prototype.added, "added and deleted"));
  say(`Reflect.set(${at}, "added", 1)`, () => {
    const answer = Reflect.set(prototype, "added", 1);
    delete prototype.added;
    return answer;
  });
  say(`Reflect.defineProperty(${at}, "added", value)`, () => {
    const answer = Reflect.defineProperty(prototype, "added", { value: 1, configurable: true });
    delete prototype.added;
    return answer;
  });
  say(`Reflect.deleteProperty(${at}, "missing")`, () => Reflect.deleteProperty(prototype, "missing"));
  say(`Object.isExtensible(${at})`, () => Object.isExtensible(prototype));
  say(`Object.isFrozen(${at})`, () => Object.isFrozen(prototype));
  say(`Object.setPrototypeOf(${at}, its own prototype)`, () => (Object.setPrototypeOf(prototype, Object.getPrototypeOf(prototype)), "allowed"));
  say(`Object.setPrototypeOf(${at}, another object)`, () => {
    const parent = Object.getPrototypeOf(prototype);
    Object.setPrototypeOf(prototype, Object.create(parent));
    Object.setPrototypeOf(prototype, parent);
    return "changed and restored";
  });
  say(`${at}.__proto__ = another object`, () => {
    const parent = Object.getPrototypeOf(prototype);
    (prototype as any).__proto__ = Object.create(parent);
    const changed = Object.getPrototypeOf(prototype) !== parent;
    Object.setPrototypeOf(prototype, parent);
    return changed ? "changed and restored" : "unchanged";
  });
  say(`Reflect.setPrototypeOf(${at}, another object)`, () => {
    const parent = Object.getPrototypeOf(prototype);
    const answer = Reflect.setPrototypeOf(prototype, Object.create(parent));
    Reflect.setPrototypeOf(prototype, parent);
    return answer;
  });
  say(`${at} has the same keys afterwards`, () => Reflect.ownKeys(prototype).map(String).join() === keysBefore);
  say(`${at}.${method} is the same function afterwards`, () => prototype[method] === before);
}

for (const [name, constructor, method] of locked) {
  const prototype = constructor.prototype as Record<PropertyKey, unknown>;
  say(`delete ${name}.prototype.${method}`, () => delete prototype[method]);
  say(`Reflect.deleteProperty(${name}.prototype, "${method}")`, () => Reflect.deleteProperty(prototype, method));
  say(`${name}.prototype.${method} is still a function`, () => typeof prototype[method]);
  say(`Object.freeze(${name}.prototype)`, () => Object.freeze(prototype) === prototype);
  say(`Object.seal(${name}.prototype)`, () => Object.seal(prototype) === prototype);
  say(`Object.preventExtensions(${name}.prototype)`, () => Object.preventExtensions(prototype) === prototype);
}

for (const [name, constructor] of locked) {
  const statics = constructor as unknown as Record<string, unknown>;
  say(`${name}.added = 1`, () => ((statics.added = 1), delete statics.added, "added and deleted"));
  say(`Object.isExtensible(${name})`, () => Object.isExtensible(constructor));
}
const replaceStatic = (holder: Record<string, unknown>, name: string) => {
  const before = holder[name];
  const replacement = () => "replaced";
  holder[name] = replacement;
  const replaced = holder[name] === replacement;
  holder[name] = before;
  return replaced && holder[name] === before ? "replaced and restored" : "unchanged";
};
say("File.prototype is Blob.prototype", () => File.prototype === Blob.prototype);
say("Response.json = f", () => replaceStatic(Response as unknown as Record<string, unknown>, "json"));
say("Response.redirect = f", () => replaceStatic(Response as unknown as Record<string, unknown>, "redirect"));
say("URL.canParse = f", () => replaceStatic(URL as unknown as Record<string, unknown>, "canParse"));
say("URL.createObjectURL = f", () => replaceStatic(URL as unknown as Record<string, unknown>, "createObjectURL"));

console.log(lines.join("\n"));
