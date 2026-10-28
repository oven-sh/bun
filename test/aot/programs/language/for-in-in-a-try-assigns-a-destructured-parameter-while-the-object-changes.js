// A for-in loop in a try assigns a parameter taken out of a pattern while its body removes, adds and replaces properties of the object.
function walk({ c = "default" } = {}, change) {
  const record = { k1: 1, k2: 2 };
  let seen = "";
  try {
    for (c in record) {
      seen += c + " ";
      change(record, c);
    }
    c &&= c + "!";
  } catch (e) {
    seen += "caught at " + c + " ";
  }
  console.log(seen + "| " + c + " | " + Object.keys(record).join());
}
const changes = [
  () => {},
  (record, name) => {
    if (name === "k1") delete record.k2;
  },
  (record, name) => {
    if (name === "k1") record.k3 = 3;
  },
  (record, name) => {
    if (name !== "k1") return;
    delete record.k2;
    record.k2 = 4;
  },
  (record, name) => {
    if (name === "k2") delete record.k1;
  },
  (record, name) => {
    if (name === "k1") Object.defineProperty(record, "k2", { enumerable: false });
  },
  (record, name) => {
    if (name === "k1") Object.setPrototypeOf(record, { inherited: 1 });
  },
  (record, name) => {
    if (name === "k2") throw new Error("stop");
  },
];
for (const change of changes) {
  walk(undefined, change);
  walk({ c: "given" }, change);
}
