// `JSON.parse(text) as T`: a recursive arm of a union that rejects a value does not end the compiled parse. The next arm is tried, a bounded number of times at one value, so the time stays linear in the text.
// IR+ ^ .*JSONTryRetry
type Markup = { tag: string; children: Markup[] } | { text: string };
type Folder = { kind: string; children: Folder[] } | { name: string; items: Folder[] };
type Shared = { below: Shared[]; a: number } | { below: Shared[]; b: number };
type Tagged = { kind: "list"; items: Tagged[] } | { kind: "pair"; left: Tagged; right: Tagged } | { leaf: number } | { leaves: Tagged[] };

const nest = (open: string, middle: string, close: string, levels: number) => open.repeat(levels) + middle + close.repeat(levels);

function check(label: string, parse: (text: string) => unknown, text: string): void {
  const start = Date.now();
  const isSame = JSON.stringify(parse(text)) === text;
  console.log(label + ": " + (isSame ? "what JSON.parse gives" : "ANOTHER VALUE") + (Date.now() - start > 1000 ? " TOO SLOWLY" : ""));
}

const markup = (text: string) => JSON.parse(text) as Markup;
check("one leaf", markup, '{"text":"a"}');
check("many leaves", markup, '{"tag":"ul","children":[' + Array(20000).fill('{"text":"a"}').join() + "]}");
for (const levels of [1, 30, 300]) check("leaves at " + levels + " levels", markup, nest('{"tag":"div","children":[{"text":"a"},', '{"text":"b"}', "]}", levels));

const folder = (text: string) => JSON.parse(text) as Folder;
for (const levels of [1, 8, 40, 200]) {
  check("the first recursive arm, " + levels + " levels", folder, nest('{"kind":"k","children":[', "", "]}", levels));
  check("the second recursive arm, " + levels + " levels", folder, nest('{"name":"n","items":[', "", "]}", levels));
  check("both in turn, " + levels + " levels", folder, nest('{"kind":"k","children":[{"name":"n","items":[', "", "]}]}", levels));
}

const shared = (text: string) => JSON.parse(text) as Shared;
for (const levels of [1, 2, 3, 4, 5, 30, 200]) {
  check("arms that share a recursive member, the first, " + levels + " levels", shared, nest('{"below":[', "", '],"a":1}', levels));
  check("arms that share a recursive member, the second, " + levels + " levels", shared, nest('{"below":[', "", '],"b":1}', levels));
}
check("the second arm beside itself", shared, '{"below":[' + Array(2000).fill('{"below":[],"b":1}').join() + '],"b":1}');

const tagged = (text: string) => JSON.parse(text) as Tagged;
check("arms with and without a tag", tagged, '{"leaves":[{"leaf":1},{"kind":"list","items":[{"leaf":2},{"kind":"pair","left":{"leaf":3},"right":{"leaves":[]}}]}]}');
check("a tag whose arm rejects", tagged, '{"kind":"list","leaves":[{"kind":"pair","leaf":1}]}');
for (const levels of [1, 5, 30, 200]) check("a tag whose arm rejects, " + levels + " levels", tagged, nest('{"kind":"list","leaves":[', "", "]}", levels));
