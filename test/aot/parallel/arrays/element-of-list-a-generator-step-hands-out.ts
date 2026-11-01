// The step of a generator hands out a list of fractions, and an element of it is read. Another function of the file makes an object with a member of the same name that holds lists of whole numbers.
function f1(): void {
  function f8(): void {
    function twin(given: number[][] = [[0, 0], [0, 0]]): { value: number[][] } { return { value: given }; }
    twin();
    function accepted(start = 0) {
      let tally = start;
      const trail: number[] = [];
      try {
        const list: number[][] = [[2.5, 2.5], [2.5, 2.5]];
        const arrived = list[0];
        function* give(given: number[]): Generator<number[], number[], unknown> { yield given; return given; }
        const derived = give(arrived).next().value[give(arrived).next().value.length - 1];
        try { tally++; } finally { trail.push(-1); }
      } catch (error) {}
      console.log([tally, trail.join()].join(" "));
    }
    for (let turn = 0; turn < 2; turn++) accepted();
  }
  try { f8(); } catch (e) {}
}
f1();
