// A literal defines a member under a name joined of two parts 3,000 times: the name is made as a name and the definition is answered by what was filed at the first
// COUNT: operation:operationAOTDefineField <= 40
const kinds: Record<string, string[]> = { json: ["a/json"], form: ["a/form"], text: ["a/text"] };
function makeParser(rest: Record<string, unknown>) {
  const enabled: Record<string, boolean> = { json: true, form: true, text: false };
  return async function optionsOf(context: { kind: string }) {
    const should = (kind: string) => Boolean(enabled[kind] && context.kind === kind);
    const kind = (() => {
      if (should("json")) return "json";
      if (should("form")) return "form";
      return null;
    })();
    if (!kind) return {};
    return {
      raw: true,
      strict: kind === "json" ? rest.jsonStrict : undefined,
      [`${kind}Types`]: kinds[kind],
      limit: rest[`${kind}Limit`],
      encoding: rest.encoding || "utf-8",
    };
  };
}
const optionsOf = makeParser({ jsonStrict: true, jsonLimit: 1, formLimit: 2 });
const turns = Number(process.argv[2] ?? 3) * 1000;
let sum = 0;
const contexts = [{ kind: "json" }, { kind: "form" }, { kind: "text" }];
for (let turn = 0; turn < turns; turn++) {
  const made: any = await optionsOf(contexts[turn % 3]);
  sum += (made.limit ?? 10) + (made.jsonTypes?.length ?? 100) + (made.formTypes?.length ?? 1000);
}
console.log(sum, JSON.stringify(await optionsOf(contexts[0])), JSON.stringify(await optionsOf(contexts[1])), JSON.stringify(await optionsOf(contexts[2])));
