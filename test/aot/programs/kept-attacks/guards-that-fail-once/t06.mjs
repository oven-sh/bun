// Guards that fail once, one probe of many. It prints what plain Bun prints.
    function makePoint(x) { return { x, y: 2 }; }
    async function returns(value) { return value; }
    const rounds = Number(process.argv[2]);
    const emptied = makePoint(1);
    emptied[process.argv[3]] = 1;
    delete emptied[process.argv[3]];
    const tagged = makePoint(2);
    tagged[process.argv[3]] = 1;
    let sum = 0;
    for (let round = 0; round < rounds; round++) sum += (await returns(emptied)).x + (await returns(tagged)).x;
    console.log(sum === 3 * rounds);
  