// A date or a time of TOML is a Temporal object, which the file makes when it runs. The file has one value, whoever asks for it and by whichever way.
import whole, { when } from "./data/dated.toml";
import * as all from "./data/dated.toml";
import text from "./data/dated.toml" with { type: "text" };
import { deep } from "./hands-on.mjs";
const kind = value => Object.prototype.toString.call(value);
console.log(JSON.stringify(whole), String(when), Object.keys(all).sort().join(), JSON.stringify(text));
console.log(kind(when), kind(deep.at), kind(deep.day), kind(deep.both), kind(whole.list[1].at), when === whole.when, deep === whole.deep);
const called = await import("./data/dated.toml");
console.log(called.default === whole, called.when === when, require("./data/dated.toml").when === when, JSON.stringify(require("./data/dated.toml")));
const made = await import("./data/" + ["dated", "toml"].join("."));
console.log(made.default === whole, when.epochMilliseconds, deep.day.year + deep.at.minute, deep.both.hour);
const typed = await import("./data/dated.txt", { with: { type: "toml" } });
console.log(JSON.stringify(typed.default), kind(typed.default.day), typed.default.day.equals(deep.day));
