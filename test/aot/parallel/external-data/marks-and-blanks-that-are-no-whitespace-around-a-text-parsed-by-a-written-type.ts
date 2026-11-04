// A byte order mark, a zero, blanks that JSON does not count as whitespace and wide characters whose low byte is a blank stand in front of, inside and behind a text that is parsed by a written type: the value or the SyntaxError of JSON.parse.
type Config = { port: number; host: string };
function load(text: string) { return JSON.parse(text) as Config; }
function tell(text: string) {
  try { const c = load(text); return Object.keys(c).join() + " | " + String(c.port) + " | " + String(String(c.host).length); } catch (error) { return (error as Error).name + " " + String((error as Error).message.length); }
}
const good = '{"port":1,"host":"a"}';
const marks = ["﻿", "\u0000", " ", "\u000b", "\u000c", "\u0085", "ÿ", "Ġ", "ਠ", " ", " ", "　", "∬", "≽", " ", "\t", "\n", "\r", " \t\r\n "];
for (let round = 0; round < 3; round++) {
  for (const mark of marks) {
    console.log(tell(mark + good));
    console.log(tell(good + mark));
    console.log(tell("{" + mark + '"port":1,"host":"a"}'));
    console.log(tell('{"port"' + mark + ':1,"host":"a"}'));
    console.log(tell('{"port":' + mark + '1,"host":"a"}'));
    console.log(tell('{"port":1' + mark + ',"host":"a"}'));
    console.log(tell('{"port":1,"host":"a"' + mark + "}"));
    console.log(tell('{"port":1,"host":"a' + mark + '"}'));
    console.log(tell('{"port":1,"ho' + mark + 'st":"a"}'));
  }
}
for (const bad of ["", " ", good + good, good + ",", good + "}", good + "x", good + "中", "[" + good, good.slice(0, -1), good + "\u0000" + good, good + " \u0000", "中"]) console.log(tell(bad));
