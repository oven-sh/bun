// Which calls run. A mark lets a call go whose value nobody takes. `bun build` looks for the mark where it starts to parse an expression, and it drops casts and parentheses as it parses.
// What stands behind `<T>` goes on the expression that the cast starts: a mark in front of the cast is the operand's, and a mark between the two is nobody's.
const calls: string[] = [];
function f(name?: any): any {
  calls.push(String(name));
  return f;
}
class C {
  constructor(name: string) {
    calls.push(name);
  }
}
function run() {
  /* @__PURE__ */ <any>f("mark, cast");
  // @__PURE__
  <any>f("line comment, cast");
  /* @__PURE__ */
  <any>f("mark, line break, cast");
  /* @__PURE__ */ <const>f("mark, const cast");
  /* @__PURE__ */ <any><unknown>f("mark, two casts");
  /* @__PURE__ */ <any>(f("mark, cast, parentheses"));
  /* @__PURE__ */ <any>(f("mark, cast, as in parentheses") as unknown);
  /* @__PURE__ */ <any>(<unknown>f("mark, cast, cast in parentheses"));
  /* @__PURE__ */ <any>new C("mark, cast, new");
  /* @__PURE__ */ <any>f<number>("mark, cast, type arguments");
  /* @__PURE__ */ <any>f?.("mark, cast, optional call");
  /* @__PURE__ */ <any>f("mark, cast, two calls: first")("mark, cast, two calls: second");
  /* @__PURE__ */ <any>(f("mark, cast, call of parentheses: first"))("mark, cast, call of parentheses: second");
  typeof /* @__PURE__ */ <any>f("typeof, mark, cast");
  /* @__PURE__ */ <any>/* @__PURE__ */ f("mark, cast, mark");
  /* @__PURE__ */ (<any>f("mark, cast in parentheses"));
  /* @__PURE__ */ (<any>(f("mark, cast and parentheses in parentheses")));
  /* @__PURE__ */ (f("mark, as in parentheses") as any);
  /* @__PURE__ */ (f("mark, satisfies in parentheses") satisfies any);
  /* @__PURE__ */ (f("mark, as const in parentheses") as const);
  /* @__PURE__ */ ((f("mark, as twice in parentheses") as any) as unknown);
  /* @__PURE__ */ f("mark, call, as") as any;
  /* @__PURE__ */ f("mark, call, as a number") as number;
  /* @__PURE__ */ <number>f("mark, cast to a number");
  /* @__PURE__ */ new C("mark, new, as") as any;
  /* @__PURE__ */ f(f("kept: the argument of a marked call under as")) as any;
  [/* @__PURE__ */ f("mark and as in a list") as any];
  void (/* @__PURE__ */ f("void, mark and as in parentheses") as any);
  calls.length ? (/* @__PURE__ */ f("mark and as in an arm") as any) : 2;
  calls.length && (/* @__PURE__ */ f("mark and as behind &&") as any);
  (/* @__PURE__ */ f("mark and as ahead of a comma") as any), 1;
  <any>(/* @__PURE__ */ f("cast, mark in parentheses"));
  <any>(/* @__PURE__ */ <unknown>f("cast, mark and cast in parentheses"));

  <any>/* @__PURE__ */ f("kept: cast, mark");
  <const>/* @__PURE__ */ f("kept: const cast, mark");
  <any>/* @__PURE__ */ (f("kept: cast, mark, parentheses"));
  <any>/* @__PURE__ */ <unknown>f("kept: cast, mark, cast");
  <any><unknown>/* @__PURE__ */ f("kept: two casts, mark");
  <Array<any>>/* @__PURE__ */ f("kept: cast to a type with arguments, mark");
  <(any)>/* @__PURE__ */ f("kept: cast to a type in parentheses, mark");
  <any>/* note */ /* @__PURE__ */ f("kept: cast, comment, mark");
  <any>/* @__PURE__ */ new C("kept: cast, mark, new");
  (<any>/* @__PURE__ */ f("kept: cast and mark in parentheses"));
  <any>(<unknown>/* @__PURE__ */ f("kept: cast, cast and mark in parentheses"));
  <any>/* @__PURE__ */ f("kept: cast, mark, comma"), 1;
  </* @__PURE__ */ any>f("kept: mark in the type");
  <any /* @__PURE__ */>f("kept: mark behind the type");
  /* @__PURE__ */ <any>f("kept: mark, cast, member").member;
  /* @__PURE__ */ <any>-f("kept: mark, cast, minus");
  /* @__PURE__ */ <any>f`kept: mark, cast, template`;
  /* @__PURE__ */ (f("kept: mark, member under as in parentheses").member as any);
  return [<any>/* @__PURE__ */ f("kept: the value is taken")].length;
}
run();
{
  /* @__PURE__ */ f("in a block: mark, call, as") as any;
  /* @__PURE__ */ <any>f("in a block: mark, cast");
  <any>/* @__PURE__ */ f("kept: in a block: cast, mark");
}
if (calls.length) {
  /* @__PURE__ */ f("under if: mark, call, as") as any;
}
class Methods {
  method() {
    /* @__PURE__ */ f("in a method: mark, call, as") as any;
    /* @__PURE__ */ <any>f("in a method: mark, cast");
    <any>/* @__PURE__ */ f("kept: in a method: cast, mark");
  }
}
new Methods().method();
const arrow = () => {
  /* @__PURE__ */ f("in an arrow function: mark, call, as") as any;
};
arrow();
/* @__PURE__ */ <any>f("at the top: mark, cast");
/* @__PURE__ */ f("at the top: mark, call, as") as any;
<any>/* @__PURE__ */ f("kept: at the top: cast, mark");
console.log(calls.join("\n"));
