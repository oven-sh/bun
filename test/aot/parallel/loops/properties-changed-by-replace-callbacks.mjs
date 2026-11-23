// A static field is read in front of a loop, and a callback of a built-in changes it inside the loop.
function makeText(n) {
  switch (n % 5) {
    case 2:
      return "b" + "ab".repeat(n % 3);
    default:
      return "";
  }
}

class Settings {
  static text = makeText(0);
}

function setText(value) {
  Settings.text = value;
}

function readWhileReplacing(at) {
  const seen = [];
  for (let i = 0; i < 8; i++) {
    seen.push(Settings.text.length);
    if (i === at % 8) {
      "x".replace(/x/, () => {
        Settings.text = "";
      });
    }
    seen.push(Settings.text.indexOf("b"));
  }
  return seen.join();
}

void setText;
const kept = new Map();
const opaque = value => {
  kept.set("value", value);
  return kept.get("value");
};
const run = opaque({ readWhileReplacing });

for (let k = 0; k < 14; k++) {
  Settings.text = makeText(k);
  console.log(run.readWhileReplacing(k));
}
