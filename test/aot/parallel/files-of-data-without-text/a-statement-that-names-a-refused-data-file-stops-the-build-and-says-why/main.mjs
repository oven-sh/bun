import json from "./nothing.txt" with { type: "json" };
import toml from "./broken.toml";
console.log(typeof json, typeof toml);
/* Build errors:
error: TS100164: "broken.toml" could not be parsed as toml: Expected a key but found '='
error: TS100164: "nothing.txt" could not be parsed as json: JSON Parse error: Unexpected EOF
*/
