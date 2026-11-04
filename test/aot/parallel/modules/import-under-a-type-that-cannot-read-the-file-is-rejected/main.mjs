// Todo: the promise is rejected with a ResolveMessage, as if the file were missing, and not with the error of whoever reads the text
// An import() asks for a TOML file as JSON, which cannot read it. Prints the name of the error that the promise is rejected with.
import "./d.toml" with { type: "toml" };
const said = await import("./d.toml", { with: { type: "json" } }).then(
  () => "resolved",
  error => "rejected: " + error.name,
);
console.log(said);
