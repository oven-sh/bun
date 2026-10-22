// Guards that fail once, one probe of many. It prints what plain Bun prints.
    class Point {
      constructor(x) { this.x = x; }
    }
    const rounds = Number(process.argv[2]);
    async function awaits(value) {
      let sum = 0;
      for (let round = 0; round < rounds; round++) sum += (await value).x;
      return sum;
    }
    const alone = [await awaits({ x: 1 }), await awaits(new Point(2))];
    const together = await Promise.all([awaits({ x: 3 }), awaits(new Point(4)), awaits({ x: 5 })]);
    console.log([...alone, ...together].map(sum => sum / rounds).join(" "));
  