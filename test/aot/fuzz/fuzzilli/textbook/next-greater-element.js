function nextGreater(list) {
  const out = [];
  const stack = [];
  for (let i = list.length - 1; i >= 0; i--) {
    while (stack.length > 0 && stack[stack.length - 1] <= list[i]) stack.pop();
    out[i] = stack.length > 0 ? stack[stack.length - 1] : -1;
    stack.push(list[i]);
  }
  return out;
}
console.log(nextGreater(JSON.parse("[4,5,2,25,7,8]")).join());
