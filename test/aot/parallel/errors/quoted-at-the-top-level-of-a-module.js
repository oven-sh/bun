// A TypeError quotes what failed as it is written. Nothing here fails inside a function: every statement stands at the top level of the module.
const nothing = Proxy.prototype;
const holder = { none: null, list: [1], deep: { none: undefined } };
const show = (label, error) => console.log(label + ": " + error.constructor.name + ": " + error.message);

try { console.log("nothing" in Proxy.prototype); } catch (error) { show("key test", error); }
try { console.log(Object.getOwnPropertyNames(Proxy.prototype)); } catch (error) { show("names", error); }
try { console.log("a" in holder.none); } catch (error) { show("key test of a member", error); }
try { console.log(holder.list[0] in holder.deep.none); } catch (error) { show("computed key test", error); }
try { console.log(Object.keys(holder.none)); } catch (error) { show("keys", error); }
try { console.log(Object.hasOwn(holder.deep.none, "a")); } catch (error) { show("hasOwn", error); }
try { console.log(Array.prototype.push.call(holder.none, 1)); } catch (error) { show("push", error); }
try { console.log(Proxy.prototype.x); } catch (error) { show("read", error); }
try { console.log(holder.deep.none.x.y); } catch (error) { show("deep read", error); }
try { console.log(holder.none[holder.list[0]]); } catch (error) { show("element", error); }
try { holder.none.x = 1; } catch (error) { show("store", error); }
try { holder.none.n++; } catch (error) { show("update", error); }
try { delete holder.none.x; } catch (error) { show("deletion", error); }
try { holder.none.run(1, "two"); } catch (error) { show("call of a member of null", error); }
try { holder.list.run(1); } catch (error) { show("call of what is no function", error); }
try { new holder.list.K(1); } catch (error) { show("construction", error); }
try { const [first] = holder.none; console.log(first); } catch (error) { show("list pattern", error); }
try { for (const each of holder.deep.none) console.log(each); } catch (error) { show("loop", error); }
try { console.log(`${holder.none.t}`); } catch (error) { show("template", error); }

// Over several lines, with a comment in between.
try {
  console.log(
    Object.keys(
      holder.none, // refused
    ),
  );
} catch (error) {
  show("call over lines", error);
}

// Beside functions: one that runs, one that nobody enters, and one that is handed to what fails.
const runs = function (o) { return o.x; }, never = function (o) { return o.never; }, failed = (() => { try { return holder.none.beside; } catch (error) { return error; } })();
show("beside functions", failed);
try { runs(holder.none); } catch (error) { show("in the function beside", error); }
try { holder.none.each(function (o) { return o.y; }); } catch (error) { show("a function is an argument", error); }
try { holder.none.each((o) => o.y, holder.list); } catch (error) { show("an arrow is an argument", error); }

/**
 * A comment above a function is no text of the module's body.
 */
function declared(o) {
  return o.declared;
}
try { declared(holder.none); } catch (error) { show("declared", error); }
try { console.log(holder.none.behindDeclaration); } catch (error) { show("behind a declaration", error); }

// In what a class runs where it is defined.
try { class A { [holder.none.key]() {} } console.log(A); } catch (error) { show("computed name of a method", error); }
try { class C { static { holder.none.block = 1; } } console.log(C); } catch (error) { show("static block", error); }
try { class E extends holder.none.parent {} console.log(E); } catch (error) { show("parent", error); }

// Statements that only name data or functions stand between those that fail.
const table = [1, "two", { three: [3] }], text = `four`;
"a text that is a statement";
const arrow = (o) => o.arrow;
try { console.log(table[2].four.x, text); } catch (error) { show("behind data", error); }
try { arrow(holder.none); } catch (error) { show("in an arrow with a name", error); }

// Letters that take more than one byte stand in front of the place.
try { console.log("żółć 漢字 😀", holder.none.behindLetters); } catch (error) { show("behind letters", error); }

// The same text twice on one line, and on two lines.
try { console.log(holder.list.x, holder.none.x, holder.deep.x); } catch (error) { show("one of three", error); }
try { console.log(nothing.same); } catch (error) { show("first of two", error); }
try { console.log(nothing.same); } catch (error) { show("second of two", error); }

// Behind keywords that a whole expression follows.
try { throw "a" in holder.none; } catch (error) { show("thrown key test", error); }
try { switch (true) { case "a" in holder.none: break; } } catch (error) { show("key test of a case", error); }
try { if (!holder) holder.x = 1; else "a" in holder.none; } catch (error) { show("key test behind else", error); }

label: for (const each of holder.list) {
  if (each) {
    switch (each) {
      case 1:
        try { holder.none.nested(); } catch (error) { show("nested statements", error); }
        break label;
    }
  }
}
