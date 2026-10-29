// The same copy again and again: the source mixes fields of the target with names that the target's type does not list, so fields are created between added names,
// and some targets have such names before the copy. Then one copy in the row brings a value that its field does not take, and the row goes on.
type Style = {
  color?: string;
  width?: number;
  bold?: boolean;
  margin?: number;
  label?: string;
  onPress?: () => string;
};

function parse(text: string): any {
  return JSON.parse(text);
}

function show(title: string, object: object) {
  console.log(title, JSON.stringify(object), Object.keys(object).join(","));
}

function withDefaults(given: any): Style {
  return { color: "black", ...given, bold: true };
}

function ontoNamesOfItsOwn(first: any, second: any): Style {
  return { ...first, ...second, margin: 4 };
}

function assigned(given: any): Style {
  const style: Style = { width: 1 };
  return Object.assign(style, given);
}

const mixed = '{"extraA":1,"width":10,"extraB":"two","label":"x","extraC":[3],"margin":2}';
const onlyNames = '{"first":1,"second":2}';
for (let round = 0; round < 6; ++round) {
  show("defaults " + round, withDefaults(parse(mixed)));
  show("own names " + round, ontoNamesOfItsOwn(parse(onlyNames), parse(mixed)));
  show("assigned " + round, assigned(parse(mixed)));
}

const odd = '{"extraA":1,"width":"wide","extraB":"two","label":7,"extraC":[3],"margin":2}';
show("odd defaults", withDefaults(parse(odd)));
show("odd own names", ontoNamesOfItsOwn(parse(onlyNames), parse(odd)));
show("odd assigned", assigned(parse(odd)));
for (let round = 0; round < 3; ++round) {
  show("defaults again " + round, withDefaults(parse(mixed)));
  show("own names again " + round, ontoNamesOfItsOwn(parse(onlyNames), parse(mixed)));
  show("assigned again " + round, assigned(parse(mixed)));
}

// A typed source with a name added behind its back, and a callback that nobody has called yet.
function styled(index: number): Style {
  const style: Style = { width: index, onPress: () => "pressed " + index };
  (style as any)["data-" + (index % 2)] = index;
  style.label = "l" + index;
  return style;
}
for (let index = 0; index < 8; ++index) {
  const copy = withDefaults(styled(index));
  show("typed " + index, copy);
  console.log(copy.onPress!(), copy.width, copy.label, copy.bold);
  const changed: Style = { ...copy, width: index * 2 };
  delete changed.color;
  show("changed " + index, { ...changed, color: "red" });
}
