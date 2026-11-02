export let orderSum = 0;
let position = 0;
export function record(id) { orderSum += ++position * id; }
