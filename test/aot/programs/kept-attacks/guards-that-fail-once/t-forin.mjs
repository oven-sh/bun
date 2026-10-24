// Guards that fail once: t forin. It prints what plain Bun prints.
    class Options {
      constructor() { this.host = "localhost"; this.port = 80; }
    }
    const rounds = Number(process.argv[2]);
    const extra = "ex" + process.argv[3];
    const port = "po" + process.argv[4];
    const change = (object, f) => { f(object); return object; };
    const objects = [
      change(new Options(), o => { o[extra] = 1; }),
      change(new Options(), o => { o[extra] = 1; delete o[extra]; }),
      change(new Options(), o => { o[port] = "eighty"; o[port] = 80; }),
      change({ first: 1, second: 2 }, o => { o[extra] = 3; }),
    ];
    function walk(object) {
      let keys = "";
      for (const key in object) keys += key + " ";
      return keys.trim();
    }
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(walk(objects[round & 1 ? 3 : 0]));
    console.log([...seen].join(" | "));
    console.log(objects.map(walk).join(" | "));
    objects[0][extra + "2"] = 2;
    objects[1][extra] = 4;
    delete objects[2][port];
    delete objects[3][extra];
    Object.defineProperty(objects[3], "hidden", { value: 1, enumerable: false });
    console.log(objects.map(walk).join(" | "));
    console.log(objects.map(walk).join(" | "));
    Options.prototype[extra + "3"] = 5;
    console.log(objects.map(walk).join(" | "));
  