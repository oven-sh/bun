const json = await (await fetch("https://raw.githubusercontent.com/jshttp/mime-db/master/db.json")).json();

json["application/javascript"].extensions.push(`ts`, `tsx`, `mts`, `mtsx`, `cts`, `cjs`, `mjs`, `js`);

delete json["application/node"];
delete json["application/deno"];
delete json["application/wasm"];

var categories = new Set();
var all = "pub const all = struct {";
for (let key of Object.keys(json).sort()) {
  const [category] = key.split("/");
  categories.add(category);
  all += `pub const @"${key}": MimeType = MimeType{.category = .@"${category}", .value = "${key}"};\n`;
}

const withExtensions = [
  ...new Set(
    Object.keys(json)
      .filter(key => {
        return !!json[key]?.extensions?.length;
      })
      .flatMap(mime => {
        return [...new Set(json[mime].extensions)].map(ext => {
          return [`.{.@"${ext}", all.@"${mime}"}`];
        });
      })
      .sort(),
  ),
];

all += "\n";

all += `  pub const extensions = ComptimeStringMap(MimeType, .{
${withExtensions.join(",\n")},
});
};`;

all += "\n";

// all += `pub const Category = enum {
//     ${[...categories].map((a) => `@"${a}"`).join(", \n")}
// };
// `;

console.log(all);
