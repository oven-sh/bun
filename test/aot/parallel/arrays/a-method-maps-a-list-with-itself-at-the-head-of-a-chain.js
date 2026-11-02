class Query {
  constructor() {
    this.asked = [];
  }
  where(part, prefix) {
    let condition = "";
    if (Array.isArray(part)) {
      if (part.length) {
        condition = part
          .map(item => {
            return this.where(item, prefix);
          })
          .filter(each => !!each)
          .map(each => "(" + each + ")")
          .join(" OR ");
      }
    } else {
      const all = [];
      for (const key in part) {
        if (key === "") throw new Error("a part without a name");
        this.asked.push(prefix + key);
        all.push(prefix + key + " = " + part[key]);
      }
      condition = part.text === undefined ? all.join(" AND ") : part.text;
    }
    return condition;
  }
}
const query = Reflect.construct(Query, []);
for (const parts of [JSON.parse('[{"a":1,"b":2},[{"c":3},{}],{"d":4,"text":7},[]]'), JSON.parse('[[[{"z":0}]]]'), JSON.parse("[]")]) {
  for (const each of [query]) console.log(each.where(parts, "t."));
}
console.log(query.asked.join());
try {
  for (const each of [query]) each.where(JSON.parse('[{"e":5},[{"":6}]]'), "u.");
} catch (error) {
  console.log(error.message, query.asked.join());
}
