function picked(record, keys) {
  const out = {};
  for (const key of keys) {
    if (key in record) out[key] = record[key];
  }
  return out;
}
const whole = JSON.parse('{"id":7,"name":"ash","secret":"x"}');
const part = picked(whole, ["id", "name", "none"]);
console.log(part.id, JSON.stringify(part));
