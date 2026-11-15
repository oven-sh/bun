// Sources of some hundred kilobytes are evaluated one behind the other, with and without a collection between, and functions in older ones are first run when newer ones have been evaluated.
const indirect = eval;
function source(number, members) {
  let text = "";
  for (let i = 0; i < members; i++) {
    text += `
      member${i}(value${i}) {
        const outer${i} = value${i} + ${i}, list = [${i}, outer${i}];
        function inner(argument${i}) {
          return () => argument${i} + outer${i} + (class Local { static named${i} = ${number}; #hidden = 1; get() { return this.#hidden + Local.named${i}; } }, new (class { own = ${i}; read() { return this.own; } })().read());
        }
        return inner(list.length)() + (({ a, ...rest }) => a + Object.keys(rest).length)({ a: 1, b${i}: 2, c: 3 });
      },`;
  }
  return `({ number: ${number}, ${text} last${number}: () => typeof unheardOf${number} })`;
}
const kinds = [
  text => indirect(text),
  text => eval(text),
  text => new Function("return " + text)(),
  text => indirect(`(function () { "use strict"; return ${text} })()`),
];
const made = [];
const log = [];
for (let i = 0; i < 12; i++) {
  made.push(kinds[i % kinds.length](source(i, 400)));
  if (i % 3 === 1) Bun.gc(true);
  // A few functions of every older source, none of which has run before.
  for (const [index, object] of made.entries()) {
    const name = "member" + ((i * 31 + index * 7) % 400);
    log.push(`${i} ${object.number} ${name} ${object[name](index)} ${object["last" + object.number]()}`);
  }
}
// Small sources between large ones, with names of both.
for (let i = 0; i < 300; i++) log.push(String(new Function("value" + i, `return value${i} + (function inner(argument${i}) { return argument${i} })(${i})`)(i)));
made.push(indirect(source(99, 50)));
log.push(String(made.at(-1).member7(1)), String(made[0].member399(2)));
let hash = 0;
for (const line of log) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(log.length, hash, log.filter((_, i) => i % 40 === 0).join(" | "));
