// Two import statements ask for one file as two types that share a place in the loader: the first decides for both, and for an import() whose type is known only when it runs.
import * as asText from "./first.txt" with { type: "text" };
import * as asToml from "./first.txt" with { type: "toml" };
import * as tomlFirst from "./second.txt" with { type: "toml" };
import * as textSecond from "./second.txt" with { type: "text" };
import * as asThird from "./third.toml" with { type: "text" };
const show = (label, first, second) => console.log(label + ":", JSON.stringify(first.default), JSON.stringify(second.default), first === second);
show("text then toml", asText, asToml);
show("toml then text", tomlFirst, textSecond);
const options = { with: { type: globalThis.neverSet ? "text" : "toml" } };
show("a statement, then a type known at run time", asThird, await import("./third.toml", options));
