function chain(values) {
  let head = null;
  for (let i = values.length - 1; i >= 0; i--) {
    head = { value: values[i], next: head };
  }
  return head;
}
function total(head) {
  let sum = 0;
  for (let node = head; node; node = node.next) sum += node.value;
  return sum;
}
const head = chain(JSON.parse("[4,8,15]"));
console.log(head.value, total(head), JSON.stringify(head));
