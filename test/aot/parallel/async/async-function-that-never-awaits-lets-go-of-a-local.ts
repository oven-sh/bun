// Flags: --aot-verify-each-pass
// An async function without an await sets a local to undefined. No pass that is left out of such a body has something to do there.
const hostOf = async (request: { url: string }) => {
  let url: URL | undefined;
  try {
    url = new URL(request.url);
  } catch {
    url = undefined;
  }
  return url?.hostname ?? "<none>";
};

type Answer = { kind: "text"; text: string };
const change = async (words: string, room: { settings?: Map<string, string> }): Promise<Answer> => {
  const settings = room.settings;
  if (!settings) return { kind: "text", text: "no settings here" };
  const trimmed = words.trim();
  let name: string;
  let value: string | undefined;
  const equals = trimmed.indexOf("=");
  if (equals !== -1) {
    name = trimmed.slice(0, equals);
    value = trimmed.slice(equals + 1);
  } else {
    name = trimmed;
    value = undefined;
  }
  if (value === undefined) {
    settings.delete(name);
    return { kind: "text", text: `unset ${name}` };
  }
  settings.set(name, value);
  return { kind: "text", text: `set ${name}` };
};

function* never(list: string[]) {
  let last: string | undefined = list[0];
  if (list.length > 100) yield last;
  last = undefined;
  return String(last);
}

console.log(await hostOf({ url: "https://example.com/a" }), await hostOf({ url: "no" }));
const room = { settings: new Map<string, string>() };
for (const words of ["a=1", "a", "b = 2"]) console.log((await change(words, room)).text, room.settings.size);
console.log((await change("a", {})).text, never(["x"]).next().value);
