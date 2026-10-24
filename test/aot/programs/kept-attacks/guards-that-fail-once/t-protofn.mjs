// Guards that fail once: t protofn. It prints what plain Bun prints.
    const rounds = Number(process.argv[2]);
    const named = (f, name) => { f.displayName = name; return f; };
    class Component { isComponent() { return true; } }
    const holder = { method() {} };
    const types = [
      named(() => 1, "arrow"),
      named(async () => 1, "async arrow"),
      named(holder.method, "method"),
      named(function () {}, "function"),
      named(class extends Component {}, "class"),
    ];
    function constructs(type) {
      return type.displayName + " " + !!(type.prototype && type.prototype.isComponent) + " " + ("prototype" in type) + " " + Object.hasOwn(type, "prototype");
    }
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(constructs(types[round % types.length]));
    console.log([...seen].join(" | "));
    types[0].prototype = new Component();
    Object.setPrototypeOf(types[1], Object.create(Function.prototype, { prototype: { value: new Component() } }));
    console.log(types.map(constructs).join(" | "), "|", constructs(named(() => 2, "another arrow")), "|", constructs(named(async () => 2, "another async arrow")));
  