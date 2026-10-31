// `source` and `toString()` of a literal read as under `bun run`, which hands the engine every character outside printable ASCII as an escape.
const rows = [/a	b/, /[	]/, //, /é/, /é/u, /é/i, /[α-ω]+/, /α|β/v, /😀/, /😀/u, /[😀-🙏]/u, /aé/, /\//, /[/]/, /\n/, /ÿ\xff/, /一二/, /\u{1f600}/u, /(?<名>a)\k<名>/, /(?<名>a)\k<名>/u];
for (const pattern of rows) console.log(JSON.stringify(pattern.source), JSON.stringify(String(pattern)), pattern.test("é α 😀 aé / \n ÿÿ 一二 aa"), JSON.stringify(Object.keys(pattern.exec("aa é α 😀 ÿÿ 一二 / \n")?.groups ?? {})));
console.log(JSON.stringify(new RegExp("é").source), JSON.stringify(new RegExp("😀", "u").source), JSON.stringify(new RegExp(/é/).source), JSON.stringify(new RegExp(/é/, "g").source));
