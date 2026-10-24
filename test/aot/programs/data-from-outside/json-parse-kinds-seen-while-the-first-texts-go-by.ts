// The parser that expects keys lets sixteen texts of a beginning go by. If there are two to eight kinds among them (a kind: the first two strings of a text), the beginning starts told apart: each kind has a root shape and a credit of its own, and a kind that is served badly is not carried by one that is served well. A first value that is new every time, or one of many, names no kind.
function measure(label: string, count: number, make: (at: number) => string) {
  let wrong = 0;
  for (let at = 0; at < count; at++) {
    const text = make(at);
    const value: unknown = JSON.parse(text);
    if (JSON.stringify(value) !== text) wrong++;
  }
  console.log(label + ": " + count + " texts, " + wrong + " wrong");
}
measure("two kinds in turn", 100, at => (at % 2 ? '{"sort":"red","r":' + at + ',"s":2}' : '{"sort":"blue","b":"x","at":' + at + "}"));
measure("one kind", 100, at => '{"state":"on","n":' + at + "}");
measure("a first value that is new every time", 100, at => '{"token":"t' + at + '","n":1}');
measure("twenty first values in turn", 100, at => '{"group":"g' + (at % 20) + '","n":' + at + "}");
measure("a rare kind comes first", 100, at => (at ? '{"event":"' + (at % 2 ? "open" : "shut") + '","at":' + at + "}" : '{"event":"hello","version":1}'));
measure("three rare kinds come first", 100, at => (at > 3 ? '{"phase":"' + (at % 2 ? "rise" : "fall") + '","at":' + at + "}" : '{"phase":"' + ["one", "one", "two", "three"][at] + '","version":1}'));
const prose = "word ".repeat(400);
measure("a small kind and one of long strings", 600, at => (at % 8 ? '{"part":"small","n":' + at + "}" : '{"part":"large","body":"' + prose + at + '"}'));
