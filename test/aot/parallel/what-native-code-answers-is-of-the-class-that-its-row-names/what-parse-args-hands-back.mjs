// util.parseArgs hands back an element of `args` and a `default` as the program made them: the same object, of whatever class, with its members.
import { parseArgs } from "node:util";
class Path {
  toString() {
    return "a/b";
  }
  parts() {
    return `${this}`.split("/");
  }
}
class Words extends Array {
  shout() {
    return this.map(word => word.toUpperCase());
  }
}
const said = [];
for (let turn = 0; turn < 30; turn++) {
  said.length = 0;
  const path = new Path();
  const url = new URL("http://host/a?b=1");
  const bytes = new Uint8Array([1, 2, 3]);
  const words = Words.of("p", "q");
  const operands = [path, url, bytes, turn];
  const { values, positionals, tokens } = parseArgs({
    args: [path, "--name", url, "--", bytes, turn],
    options: { name: { type: "string" }, listed: { type: "string", multiple: true, default: words } },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  said.push(
    positionals[0] === path,
    positionals[0].parts().join(),
    values.name === url,
    values.name.searchParams.get("b"),
  );
  said.push(positionals[1] === bytes, positionals[1].byteLength, typeof positionals[2], positionals[2] === turn);
  said.push(
    values.listed === words,
    values.listed.shout().join(),
    Object.getPrototypeOf(values) === null,
    Array.isArray(positionals),
  );
  said.push(tokens.map(token => `${token.kind}:${token.index}:${operands.indexOf(token.value)}`).join(" "));
}
console.log(said.join(" "));
