// In sloppy code a store that a frozen, sealed or non-extensible object refuses does nothing and throws nothing. Each object is read before it is stored to.
function Setting() {
  this.key = "key";
  this.value = 1;
}

function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.constructor.name;
  }
}
function valueOf(setting) {
  return setting.value;
}
function setValue(setting, value) {
  setting.value = value;
}
function noteOf(setting) {
  return setting.note;
}
function setNote(setting, note) {
  setting.note = note;
}
function remove(setting) {
  return delete setting.value;
}
function look(mark, setting) {
  console.log(
    mark + ":",
    valueOf(setting),
    valueOf(setting),
    attempt(() => setValue(setting, 2)),
    valueOf(setting),
    String(noteOf(setting)),
    attempt(() => setNote(setting, "noted")),
    String(noteOf(setting)),
    attempt(() => remove(setting)),
    String(valueOf(setting)),
    JSON.stringify(setting),
  );
}
function parsed() {
  return JSON.parse('{"value":10,"key":"parsed"}');
}

look("open", new Setting());
look("frozen", Object.freeze(new Setting()));
look("open", new Setting());
look("sealed", Object.seal(new Setting()));
look("closed", Object.preventExtensions(new Setting()));
look("frozen literal", Object.freeze({ key: "literal", value: 3 }));
look("sealed literal", Object.seal({ value: 4, key: "literal" }));
look("closed literal", Object.preventExtensions({ key: "literal", value: 5 }));
look("open parsed", parsed());
look("frozen parsed", Object.freeze(parsed()));
look("open parsed", parsed());
look("sealed parsed", Object.seal(parsed()));
look("closed parsed", Object.preventExtensions(parsed()));

var later = new Setting();
console.log("before:", valueOf(later), attempt(() => setValue(later, 6)), valueOf(later));
Object.freeze(later);
console.log("frozen later:", valueOf(later), attempt(() => setValue(later, 7)), valueOf(later), attempt(() => setNote(later, "late")), String(noteOf(later)));

look("below a frozen object", Object.create(Object.freeze(new Setting())));
look("a number", 5);
look("a text", "text");
look("true", true);
look("a symbol", Symbol("s"));
look("open", new Setting());
