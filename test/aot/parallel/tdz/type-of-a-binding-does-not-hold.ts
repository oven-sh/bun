// The checker's word on a binding is no proof. A read that needs no test for the dead zone still needs the test of its type.
interface Settings {
  port: number;
  name: string;
}
function attempt(label: string, run: () => unknown) {
  try {
    console.log(label, JSON.stringify(run()));
  } catch (error) {
    console.log(label, (error as Error).constructor.name);
  }
}

function readSettings(): Settings {
  return settings;
}
function readCount(): number {
  return count;
}
attempt("settings, early", readSettings);
attempt("count, early", readCount);
const settings: Settings = JSON.parse('{"name":7,"extra":true,"port":"eighty"}');
let count: number = JSON.parse('"three"');
console.log("settings, in the body", typeof settings.port, settings.port, typeof settings.name, settings.name, Object.keys(settings).join());
console.log("count, in the body", typeof count, count + 1);
attempt("settings, late", readSettings);
attempt("count, late", readCount);
count = JSON.parse("[4]");
console.log("count, stored again", typeof count, count + 1);

function captured(text: string) {
  const read = (): Settings => held;
  attempt("captured, early", read);
  const held: Settings = JSON.parse(text);
  console.log("captured, in the body", typeof held.port, held.port, typeof held.name, held.name);
  attempt("captured, late", read);
  return read;
}
console.log(captured('{"port":1,"name":"right"}')().name);
console.log(captured('{"name":null}')().name);
console.log(captured("[1,2]")().port);
attempt("captured, null", () => captured("null")());
