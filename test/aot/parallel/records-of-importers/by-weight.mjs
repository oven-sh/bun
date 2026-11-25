let asked = 0;
export function heavierFirst(left, right, ways) {
  asked++;
  for (let n = 0; n < ways.length; n++) {
    const way = ways[n];
    let order = 0;
    if (way === "weight") order = right.weight - left.weight;
    else if (way === "depth") order = left.depth < right.depth ? -1 : left.depth > right.depth ? 1 : 0;
    else if (way === "even") order = (left.place & 1) - (right.place & 1);
    if (order) return order;
  }
  return left.place - right.place;
}
export function heaviest(list, ways) {
  let best = list[0];
  for (let i = 1; i < list.length; i++) if (heavierFirst(list[i], best, ways) < 0) best = list[i];
  return best;
}
export const timesAsked = () => asked;
