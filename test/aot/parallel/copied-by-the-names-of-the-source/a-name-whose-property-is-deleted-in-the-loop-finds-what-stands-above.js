// The own property goes between the step and the read: the read finds the member of the engine that stands above.
function read(source) {
  const found = [];
  for (const key in source) {
    delete source[key];
    const value = source[key];
    found.push(`${key}:${typeof value}:${typeof value === "function" ? value.name : value}`);
    if (key === "constructor") found.push(value.keys({ made: "up" }).join());
  }
  return found.join(" ");
}
console.log(read(JSON.parse('{"constructor":1,"toString":2,"made":3}')));
