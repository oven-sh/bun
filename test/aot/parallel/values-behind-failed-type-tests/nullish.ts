interface Link { value: number; next: Link | null | undefined }
const taken: unknown[] = [];
function take(link: Link | null | undefined) {
  if (link == null) return -1;
  taken.push(link);
  return link.value;
}
function takeDefined(link: Link | null | undefined) {
  if (link === undefined) return -2;
  taken.push(link);
  return link === null ? -3 : link.value;
}
function takeNonNull(link: Link | null | undefined) {
  if (link === null) return -4;
  taken.push(link);
  return link === undefined ? -5 : link.value;
}
const chain: Link = { value: 1, next: { value: 2, next: null } };
const inputs = [chain, chain.next, null, undefined];
console.log(inputs.map(take).join(), inputs.map(takeDefined).join(), inputs.map(takeNonNull).join());
console.log(taken.map(each => (each === null ? "null" : each === undefined ? "undefined" : (each as Link).value)).join());
