// Frozen, sealed and non-extensible objects at reads, at stores to fields they have and at stores that would create a field. Each is read before it is stored to, so the store finds whatever the read left behind.
class Setting {
  key = "key";
  value = 1;
  note?: string;
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function valueOf(setting: Setting): number {
  return setting.value;
}
function setValue(setting: Setting, value: number): void {
  setting.value = value;
}
function noteOf(setting: Setting): string | undefined {
  return setting.note;
}
function setNote(setting: Setting, note: string): void {
  setting.note = note;
}
function remove(setting: Setting): boolean {
  return delete (setting as any).value;
}
function look(mark: string, setting: Setting): void {
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

function parsed(): Setting {
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

const later = new Setting();
console.log("before:", valueOf(later), attempt(() => setValue(later, 6)), valueOf(later));
Object.freeze(later);
console.log("frozen later:", valueOf(later), attempt(() => setValue(later, 7)), valueOf(later), attempt(() => setNote(later, "late")), String(noteOf(later)));

const laterParsed = parsed();
console.log("before:", valueOf(laterParsed), attempt(() => setValue(laterParsed, 8)), valueOf(laterParsed));
Object.freeze(laterParsed);
console.log("frozen later:", valueOf(laterParsed), attempt(() => setValue(laterParsed, 9)), valueOf(laterParsed), attempt(() => setNote(laterParsed, "late")), String(noteOf(laterParsed)));

const heir: Setting = Object.create(Object.freeze(new Setting()));
look("below a frozen object", heir);
look("open", new Setting());

export {};
