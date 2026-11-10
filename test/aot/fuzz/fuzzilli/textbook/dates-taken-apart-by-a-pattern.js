function parts(text) {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return found ? found.slice(1).map(Number) : null;
}
console.log(JSON.stringify(parts("2024-02-29")), parts("yesterday"));
