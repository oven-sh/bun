// Guards that fail once, one probe of many. It prints what plain Bun prints.
    class Registry {
      static make() { return "declared"; }
    }
    class Below extends Registry {}
    function Legacy() {}
    const rounds = Number(process.argv[2]);
    Registry["co" + process.argv[3]] = 0;
    Legacy["co" + process.argv[3]] = 0;
    function countInClass() { Registry.count++; }
    function countInFunction() { Legacy.count++; }
    function callMake() { return Registry.make() + " " + Below.make(); }
    for (let round = 0; round < rounds; round++) {
      countInClass();
      countInFunction();
    }
    const before = callMake();
    Registry.make = () => "first";
    const first = callMake();
    Registry.make = () => "second";
    const second = callMake();
    Object.freeze(Registry);
    let refused = "stored";
    try {
      countInClass();
    } catch (error) {
      refused = error.constructor.name;
    }
    console.log(Registry.count === rounds, Below.count === rounds, Legacy.count === rounds, before, "|", first, "|", second, "|", refused);
  