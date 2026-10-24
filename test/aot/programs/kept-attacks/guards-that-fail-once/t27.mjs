// Guards that fail once, one probe of many. It prints what plain Bun prints.
    class List extends Array {}
    const rounds = Number(process.argv[2]);
    function describe(value) {
      return (value.name ?? "none") + " " + (value.prototype ?? "none") + " " + value.length;
    }
    const values = [[1, 2], "text", List.of(1)];
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(describe(values[round % 3]));
    console.log([...seen].join(" | "));
    values[0].name = "own";
    values[2].prototype = "own too";
    console.log(values.map(describe).join(" | "), "|", describe([]));
  