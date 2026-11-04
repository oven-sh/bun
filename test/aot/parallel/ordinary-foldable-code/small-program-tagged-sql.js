const TABLE = "users";
const LIMIT = 10;
function sql(strings, ...values) {
  return { text: strings.reduce((a, s, i) => a + s + (i < values.length ? `$${i + 1}` : ""), ""), values };
}
console.log(sql`select * from ${TABLE} where age > ${18} limit ${LIMIT}`);
