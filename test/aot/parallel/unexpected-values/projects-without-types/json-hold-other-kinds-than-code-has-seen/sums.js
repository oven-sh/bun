export function total(data) {
  let sum = 0;
  for (let i = 0; i < data.items.length; i++) sum += data.items[i].price;
  return sum;
}
export function names(data) {
  return data.items.map(item => item.name);
}
export function tagCount(data) {
  let count = 0;
  for (const item of data.items) count += item.tags.length;
  return count;
}
export const nextCount = data => data.count + 1;
export const countBits = data => data.count | 0;
export const isUnderTheLimit = data => data.count < data.limit;
export const room = data => data.limit - data.count;
export const firstPrice = data => data.items[0].price;
export const ownPrice = data => Object.keys(data.items[1]).join();
export const text = data => "" + data;
export const asked = data => data.hasOwnProperty("count");
export const keys = data => Object.keys(data).join();
