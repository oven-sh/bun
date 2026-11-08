function mark(_target: unknown, _key: string) {}
function build(round: number) {
  function countNames() { return Registry.names.length + round; }
  function attempt() { try { return String(countNames()); } catch (error: any) { return String(error.name); } }
  class Registry {
    static names = ["a", "b"];
    @mark static size = attempt();
    @mark static later = () => Registry.names.length + round;
  }
  return Registry.size + ":" + Registry.later();
}
let right = 0;
let last = "";
for (let round = 0; round < 300; round++) { last = build(round); if (last === (round + 2) + ":" + (round + 2)) right++; }
console.log(right, last);
