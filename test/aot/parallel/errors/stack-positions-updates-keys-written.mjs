// Each line: the frames of an error under an update of a member whose key is written as an object: the getter's caller stands at the object, and the test of the object at the last record.
function show(label, error) {
  const frames = String(error.stack).split("\n").slice(1, 4);
  const places = frames.map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/ ]+:\d+:\d+)\)?/, "$1"));
  console.log(label, "|", error.name, "|", places.join(" < "));
}
const k = "count";
function create() {
  return {
    get count() {
      throw new Error("getter");
    },
  };
}
const forms = [
  function postfix(q) {
    q[new String(k)]++;
  },
  function prefix(q) {
    ++q[new String(k)];
  },
  function add(q) {
    q[new String(k)] += 2;
  },
  function logical(q) {
    q[new String(k)] ||= 2;
  },
  function nullish(q) {
    q[new String(k)] ??= 2;
  },
  function literalKey(q) {
    q[{ toString: () => k }]++;
  },
  function listKey(q) {
    q[[k]] += 1;
  },
  function functionKey(q) {
    q[function () {}] ??= 1;
  },
  function constructionThrows(q) {
    class Key {
      constructor() {
        throw new Error("construction");
      }
    }
    q[new Key(k)]++;
  },
  function conversionThrows(q) {
    q[
      {
        toString() {
          throw new Error("conversion");
        },
      }
    ]++;
  },
];
for (const form of forms) {
  for (const [name, q] of [
    ["a getter", create()],
    ["null", null],
    ["undefined", undefined],
  ]) {
    try {
      form(q);
      console.log(form.name, name, "| no error");
    } catch (error) {
      show(form.name + " " + name, error);
    }
  }
}
