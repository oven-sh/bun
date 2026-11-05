// A class, its prototype object and its instances are printed under the text that the class holds itself as `displayName`. Each class here holds it, or does not, in another way.
function show(label, shown) {
  console.log(label, Bun.inspect(shown), Bun.inspect(new shown()), Bun.inspect(shown.prototype));
}

show("a static field", class Written { static displayName = "Shown"; });
show("a static field beside others", class Written { static first = 1; static displayName = "ShownBesideOthers"; static last = 2; });
show("an empty text", class Written { static displayName = ""; });
show("a number", class Written { static displayName = 12; });
show("a static getter", class Written { static get displayName() { return "Computed"; } });
show("a static method", class Written { static displayName() {} });
show("none", class Written {});

class StoredLater {}
StoredLater.displayName = "ShownLater";
show("stored later", StoredLater);

class StoredOver { static displayName = "First"; }
StoredOver.displayName = "Second";
show("stored over", StoredOver);

class Deleted { static displayName = "Gone"; }
delete Deleted.displayName;
show("deleted", Deleted);

class Base { static displayName = "OfTheBase"; }
show("inherited", class Heir extends Base {});

function declared() {}
declared.displayName = "OfAFunction";
show("a function", declared);
