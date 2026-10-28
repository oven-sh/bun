console.log("classes.mjs runs");
export class Unread {}
export let count = 0;
export function bump() {
  count++;
  console.log("bumped to", count);
}
