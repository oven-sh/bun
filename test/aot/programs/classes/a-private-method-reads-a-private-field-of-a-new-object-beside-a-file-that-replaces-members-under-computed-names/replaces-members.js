function replacement() {
  return "replaced";
}

function change(object, key) {
  const was = Object.getOwnPropertyDescriptor(object, key);
  object[key] = replacement;
  const answer = object[key] === replacement;
  Object.defineProperty(object, key, was);
  return answer;
}

const rows = [
  [console, "debug"],
  [Math, "sign"],
];
for (const [object, key] of rows) console.info(key, change(object, key));
