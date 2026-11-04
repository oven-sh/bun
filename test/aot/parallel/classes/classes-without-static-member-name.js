// Classes that differ in one static member are converted one after the other. Each is asked for its own member, whichever class was converted before it.
const say = (...values) => console.log(...values);

class NoText {}
class Text { static toString() { return "Text's own"; } }
say(String(NoText).startsWith("class"), String(Text), `${Text}`, Text + "", [Text].join(), "".concat(Text));

class NoNumber {}
class Count { static valueOf() { return 21; } }
say(Number.isNaN(+NoNumber), Count * 2, Count + 1, +Count, Count > 20, Math.max(Count, 3));

class TextInField { static toString = () => "a field's"; }
class NumberInField { static valueOf = () => 8; }
say(String(TextInField), `${TextInField}`, +NumberInField, NumberInField + 1);

class Both { static toString() { return "text"; } static valueOf() { return 5; } }
say(String(Both), `${Both}`, Both + "", +Both);

class Parent {
  static toString() { return "Parent's text"; }
  static valueOf() { return 1; }
  static toJSON() { return "Parent's json"; }
  static [Symbol.toPrimitive](hint) { return "Parent's primitive " + hint; }
}
class Heir1 extends Parent {}
class Heir2 extends Parent {}
class Overrides extends Parent {
  static toString() { return "Overrides' text"; }
  static valueOf() { return 2; }
  static toJSON() { return "Overrides' json"; }
  static [Symbol.toPrimitive](hint) { return "Overrides' primitive " + hint; }
}
for (const one of [Heir1, Heir2, Heir1, Overrides, Parent, Heir2])
  say(`${one}`, one + "", JSON.stringify(one), JSON.stringify({ one }), JSON.stringify([one]), one.toString(), one.valueOf());

class TextAbove { static toString() { return "TextAbove's"; } static valueOf() { return 3; } }
class Below1 extends TextAbove {}
class Below2 extends TextAbove {}
class BelowWithOwn extends TextAbove { static toString() { return "BelowWithOwn's"; } static valueOf() { return 4; } }
class BelowWithFields extends TextAbove { static toString = () => "BelowWithFields'"; static valueOf = () => 6; }
for (const one of [Below1, Below2, BelowWithOwn, BelowWithFields, TextAbove]) say(String(one), +one);

class Bare {}
class BareHeir extends Bare {}
class BareHeirWithOwn extends Bare { static toString() { return "BareHeirWithOwn's"; } }
say(String(BareHeir).startsWith("class"), String(BareHeirWithOwn), String(Bare).startsWith("class"));
Bare.toString = () => "stored on Bare";
say(String(BareHeir), String(BareHeirWithOwn), String(Bare));

class First { static toString() { return "First's"; } }
class Second {}
say(String(First), String(Second).startsWith("class"), String(First));

class StoredLater {}
say(String(StoredLater).startsWith("class"));
StoredLater.toString = () => "stored later";
say(String(StoredLater));
class DefinedLater {}
say(String(DefinedLater).startsWith("class"));
Object.defineProperty(DefinedLater, "toString", { value: () => "defined later" });
say(String(DefinedLater));
class Deleted { static toString = () => "before the delete"; }
say(String(Deleted));
delete Deleted.toString;
say(String(Deleted).startsWith("class"));
Deleted.toString = () => "after the delete";
say(String(Deleted));
