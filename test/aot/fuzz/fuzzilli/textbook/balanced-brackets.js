function closesInOrder(text) {
  const open = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  for (let i = 0; i < text.length; i++) {
    const one = text[i];
    if (one === "(" || one === "[" || one === "{") open.push(one);
    else if (open.pop() !== pairs[one]) return false;
  }
  return open.length === 0;
}
console.log(closesInOrder(JSON.parse('"{[()]}"')), closesInOrder(JSON.parse('"{[(])}"')));
