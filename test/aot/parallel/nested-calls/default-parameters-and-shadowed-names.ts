function pick(): string { return "file"; }
function outer(a: string = pick()) {
  const first = pick();
  {
    const inBlock = pick();
    function pick(): string { return "block"; }
    return [a, first, inBlock].join(",") + "," + inner();
  }
  function pick(): string { return "function"; }
  function inner(pick: () => string = () => "parameter"): string { return pick(); }
}
console.log(outer(), outer("given"));
