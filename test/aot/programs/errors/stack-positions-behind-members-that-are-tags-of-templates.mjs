// Members are the tags of templates: the read of the member throws, or what is substituted does. The program prints the frames of each error.
function fail() {
  throw new Error("fail");
}
class Texts {
  label(_texts, ...values) {
    return values.length;
  }
}
const hidden = {
  Texts,
  make: () => new Texts(),
  none: null,
  get broken() {
    return fail();
  },
  texts: new Texts(),
};
const key = "label";
const thrower = { toString: () => String(fail()) };
const forms = [
  () => new hidden.Texts().label`${`${thrower}`}`,
  () => hidden.make().label`${`${thrower}`}`,
  () => hidden.texts.label`${`${thrower}`}`,
  () => hidden.texts[key]`${`${thrower}`}`,
  () => hidden.texts["label"]`${`${thrower}`}`,
  () => hidden.none.label`a`,
  () => hidden.broken.label`a`,
  () => hidden.broken`a`,
  () => hidden.none[key]`a`,
  () => hidden.texts.label`${`${thrower}`}`,
  () => hidden.texts.missing`a`,
  () => hidden.make().missing`${1}`,
  () => new hidden.Texts().label`a${1}b${`${thrower}`}`,
  () => hidden.texts.label`${fail()}`,
  () => new hidden.Texts().label`${`${{ toString: () => String(fail()) }}`}`,
  () => hidden.make().label`${`${{ toString: () => String(fail()) }}`}`,
  () => hidden.texts.label`${`${{ toString: () => String(fail()) }}`}`,
  () => hidden.texts[key]`${`${{ toString: () => String(fail()) }}`}`,
  () => hidden.texts["label"]`${`${{ toString: () => String(fail()) }}`}`,
  () => hidden.texts.label`${`${{ toString: () => String(fail()) }}`}`,
  () => new Texts().label`${`${{ toString: () => String(fail()) }}`}`,
  () => hidden.texts.label`a${1}b${+{ valueOf: () => fail() }}`,
  () => hidden.texts.label`a${hidden.broken}`,
  () => hidden.texts.label`a${hidden.make().broken}b${hidden.none.missing}`,
  () => hidden.texts.label`a${new hidden.Texts().label}b${`${{ toString: () => String(fail()) }}`}`,
];
let index = 0;
for (const form of forms) {
  index++;
  try {
    form();
    console.log(index, "no error");
  } catch (error) {
    console.log(
      index,
      error.stack
        .split("\n")
        .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\][\w.-]+:(\d+):(\d+)\)?$/.exec(text))
        .filter(found => found !== null)
        .map(found => found[1] + "@" + found[2] + ":" + found[3])
        .join(" < "),
    );
  }
}
