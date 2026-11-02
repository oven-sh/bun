const shelf = JSON.parse("{}");

export function put(name, value) {
  shelf[name] = value;
}

export function take(name) {
  return shelf[name];
}

export function parsed(text) {
  return JSON.parse(text);
}

export function numbersUpTo(count) {
  const numbers = [];
  for (let i = 0; i < count; i++) numbers.push(i);
  return parsed(JSON.stringify(numbers));
}
