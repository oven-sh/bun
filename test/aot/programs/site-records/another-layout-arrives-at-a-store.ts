// A store that expects one layout gets objects whose field stands in another slot or is kept in another form. Only that field changes: every neighbor keeps its value.
class Expected {
  a = 1;
  b = 2;
  c = 3;
}
class Shifted {
  before = "before";
  a = 10;
  between = "between";
  b = 20;
  c = 30;
  after = "after";
}
class Backward {
  c = 300;
  b = 200;
  a = 100;
}
class Fractions {
  a = 0.5;
  b = 1.5;
  c = 2.5;
}
class Texts {
  a = "a";
  b = "b";
  c = "c";
}
class Flags {
  a = true;
  b = false;
  c = true;
}
class References {
  a: object | null = { in: "a" };
  b: object | null = null;
  c: object | null = [3];
}
class Narrow {
  b = 2000;
}

function setA(value: Expected, to: number): void {
  value.a = to;
}
function setB(value: Expected, to: number): void {
  value.b = to;
}
function setC(value: Expected, to: number): void {
  value.c = to;
}
function look(mark: string, value: unknown): void {
  const expected = value as Expected;
  const before = JSON.stringify(value);
  setB(expected, -2);
  const afterB = JSON.stringify(value);
  setA(expected, -1.5);
  setC(expected, 2 ** 40);
  console.log(mark + ":", before, afterB, JSON.stringify(value));
}

look("expected", new Expected());
look("shifted", new Shifted());
look("shifted", new Shifted());
look("backward", new Backward());
look("shifted", new Shifted());
look("expected", new Expected());
look("fractions", new Fractions());
look("texts", new Texts());
look("flags", new Flags());
look("references", new References());
look("narrow", new Narrow());
look("texts", new Texts());
look("parsed", JSON.parse('{"c":"c","x":"x","b":"b","y":"y","a":"a","z":"z"}'));
look("parsed", JSON.parse('{"c":"c","x":"x","b":"b","y":"y","a":"a","z":"z"}'));
look("parsed, shorter", JSON.parse('{"b":0}'));
look("literal", { x: 0, a: 1, b: 2, c: 3 });
look("array", Object.assign([7, 8], { b: "of an array" }));
look("expected", new Expected());

const kept = [new Expected(), new Shifted(), new Backward(), new Fractions(), new Texts()];
setA(kept[0] as Expected, 5);
setA(kept[1] as Expected, 5);
setA(kept[2] as Expected, 5);
setA(kept[3] as Expected, 5);
setA(kept[4] as any, 5);
setA(kept[3] as Expected, 6);
setA(kept[1] as Expected, 6);
setA(kept[4] as any, 6);
setA(kept[0] as Expected, 6);
setA(kept[2] as Expected, 6);
console.log(JSON.stringify(kept));

export {};
