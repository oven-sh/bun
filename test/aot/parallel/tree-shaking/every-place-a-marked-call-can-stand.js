// Every place where a marked call can stand. `bun build` and `bun run` decide while they parse: the call goes where it is a statement, or what is left of one, and in a test whose outcome is known. It stays in the initializer of a variable that nothing reads, on the left of a comma whose right is used, and in the head of a loop or of an `if`.
// Reference: bun build --compile
const log = [];
function f(name) { log.push(name); return { name, g: f }; }
function e(name) { log.push("effect " + name); return name; }
class C { constructor(name) { log.push("new " + name); } }
const o = { f, deep: { f } };
function inner() {
  /* @__PURE__ */ f("01 plain");
  /* @__PURE__ */ f(e("02 argument with effect"));
  /* @__PURE__ */ o.f("05 method");
  /* @__PURE__ */ o.deep.f("06 deep method");
  /* @__PURE__ */ f("07 chain start").g("07 chain end");
  /* @__PURE__ */ f?.("08 optional call");
  /* @__PURE__ */ o?.f("09 optional member");
  /* @__PURE__ */ new C("10 new");
  /* @__PURE__ */ new C(e("11 new with effect"));
  /* @__PURE__ */ f("12 test") ? 1 : 2;
  /* @__PURE__ */ f("13 test with arm") ? e("13 arm") : 2;
  e("14 test") ? /* @__PURE__ */ f("14 yes") : /* @__PURE__ */ f("14 no");
  /* @__PURE__ */ f("15 left of &&") && 1;
  /* @__PURE__ */ f("16 left of && with effect") && e("16 right");
  e("17 left") && /* @__PURE__ */ f("17 right");
  /* @__PURE__ */ f("18 left of ||") || /* @__PURE__ */ f("18 right");
  /* @__PURE__ */ f("19 left of ??") ?? 1;
  /* @__PURE__ */ f("20 ===") === /* @__PURE__ */ f("20 right");
  /* @__PURE__ */ f("21 ==") == 1;
  /* @__PURE__ */ f("22 <") < 1;
  /* @__PURE__ */ f("23 +") + 1;
  typeof /* @__PURE__ */ f("24 typeof");
  void /* @__PURE__ */ f("25 void");
  !/* @__PURE__ */ f("26 not");
  -/* @__PURE__ */ f("27 minus");
  [/* @__PURE__ */ f("28 array"), e("28 beside")];
  [/* @__PURE__ */ f("29 array with spread"), ...[e("29 spread")]];
  ({ a: /* @__PURE__ */ f("30 object"), b: e("30 beside") });
  ({ [e("32 key")]: /* @__PURE__ */ f("32 computed") });
  `${/* @__PURE__ */ f("33 template")}`;
  (/* @__PURE__ */ f("34 comma left"), e("34 comma right"));
  (e("35 comma left"), /* @__PURE__ */ f("35 comma right"));
  const used = (/* @__PURE__ */ f("36 comma left, value used"), 1);
  const cond = (/* @__PURE__ */ f("37 known test, value used"), true) ? 1 : 2;
  const local = /* @__PURE__ */ f("38 unused local");
  let local2 = /* @__PURE__ */ f("39 unused let"), local3 = [/* @__PURE__ */ f("40 unused array local")];
  for (/* @__PURE__ */ f("41 for init"); log.length < 0; /* @__PURE__ */ f("41 for update")) {}
  if (/* @__PURE__ */ f("42 if test")) {}
  if (log) /* @__PURE__ */ f("43 if body without braces");
  label: /* @__PURE__ */ f("44 labeled");
  switch (1) { case 1: /* @__PURE__ */ f("45 case"); }
  do /* @__PURE__ */ f("46 do body"); while (false);
  /* @__PURE__ */ (() => e("47 function called on the spot"))();
  /* @__PURE__ */ f(/* @__PURE__ */ f("48 marked in marked"), e("48 effect beside"));
  /* @__PURE__ */ f(f("49 unmarked in marked"));
  /* @__PURE__ */ f`50 tagged template`;
  (/* @__PURE__ */ f("51 parenthesized"));
  /* @__PURE__ */ (f("52 mark before a parenthesis"));
  /* @__PURE__ */ f("53 assigned").name = 1;
  /* @__PURE__ */ f("54 member read").name;
  delete /* @__PURE__ */ f("55 delete").name;
  /* @__PURE__ */ f("56 in") in {};
  /* @__PURE__ */ f("57 !==") !== e("57 right");
  e("58 ? :") ? 1 : /* @__PURE__ */ f("58 no");
  /* @__PURE__ */ ((f("62 two parentheses")));
  /* @__PURE__ */ ( /* c */ f("63 a comment in the parentheses"));
  /* @__PURE__ */ (f("64 a comma in parentheses"), f("64 right"));
  /* @__PURE__ */ (f("65 a chain in parentheses").g("65 end"));
  /* @__PURE__ */ (new C("66 new in parentheses"));
  /* @__PURE__ */ (f("67 a member after parentheses")).name;
  /* @__PURE__ */ (f("68 a call after parentheses").g)("68 end");
  return [used, cond];
}
inner();
const arrow = () => /* @__PURE__ */ f("59 arrow body");
arrow();
async function waits() { await /* @__PURE__ */ f("60 awaited"); }
waits();
function* gen() { yield /* @__PURE__ */ f("61 yielded"); }
[...gen()];
console.log(log.join("\n"));
