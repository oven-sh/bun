// Off another object the name is any name.
function read(source, other) {
  const found = [];
  for (const key in source) found.push(`${typeof other[key]}:${typeof other[key] === "function" ? other[key].name : ""}`);
  return found.join(" ");
}
console.log(read(JSON.parse('{"constructor":1,"hasOwnProperty":2,"made":3}'), JSON.parse("{}")));
function climb(source, other) {
  for (const key in source) return other[key].getOwnPropertyNames(other[key].prototype).length > 5;
}
console.log(climb(JSON.parse('{"constructor":1}'), JSON.parse("{}")));
