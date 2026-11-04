function outer(order: number) {
  const seen: unknown[] = [];
  const viaArrow = () => helper;
  function viaDeclaration() { return helper; }
  if (order === 0) seen.push(helper, viaArrow(), viaDeclaration());
  else if (order === 1) seen.push(viaArrow(), viaDeclaration(), helper);
  else seen.push(viaDeclaration(), helper, viaArrow());
  return (seen[0] === seen[1] && seen[1] === seen[2]) + ":" + (seen[0] as () => number)() + ":" + helper();
  function helper() { return order; }
}
console.log(outer(0), outer(1), outer(2));
