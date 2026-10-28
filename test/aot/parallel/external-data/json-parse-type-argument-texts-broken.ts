// `JSON.parse(text) as T` of texts that are no JSON at their deepest place, or that nest past the end of the stack: the error is JSON.parse's, and no level of the text is read again for each level around it: at 300,000 levels that would be ninety thousand million characters a text.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Chain = { extra: unknown; next: Chain | null };
type Link = { name: string; next?: Link };
type Rows = { rows: Rows[] };

const nest = (open: string, middle: string, close: string, levels: number) => open.repeat(levels) + middle + close.repeat(levels);
const kinds: [string, (text: string) => unknown, (levels: number) => string][] = [
  ["arrays that are never closed", text => JSON.parse(text) as Json, levels => "[".repeat(levels)],
  ["objects that are never closed", text => JSON.parse(text) as Json, levels => '{"k":'.repeat(levels)],
  ["a word cut short under unknown", text => JSON.parse(text) as Chain, levels => nest('{"extra":1,"next":', '{"extra":tru,"next":null}', "}", levels)],
  ["a string without its end under unknown", text => JSON.parse(text) as Chain, levels => nest('{"extra":1,"next":', '{"extra":"s,"next":null}', "}", levels)],
  ["an array cut short under unknown", text => JSON.parse(text) as Chain, levels => nest('{"extra":1,"next":', '{"extra":[1,],"next":null}', "}", levels)],
  ["a number without digits under an undeclared key", text => JSON.parse(text) as Link, levels => nest('{"name":"n","next":', '{"name":"n","other":-}', "}", levels)],
  ["an object cut short under an undeclared key", text => JSON.parse(text) as Link, levels => nest('{"name":"n","next":', '{"name":"n","other":{"a":}}', "}", levels)],
  ["records in arrays, a key without quotes", text => JSON.parse(text) as Rows, levels => nest('{"rows":[', "{rows:[]}", "]}", levels)],
];

for (const [label, parse, text] of kinds) {
  for (const levels of [10, 1_000, 30_000, 300_000]) {
    const given = text(levels);
    let said: string;
    try {
      said = "A VALUE: " + typeof parse(given);
    } catch (error: any) {
      said = error.name;
    }
    console.log(label + ", " + levels + " levels: " + said);
  }
}
