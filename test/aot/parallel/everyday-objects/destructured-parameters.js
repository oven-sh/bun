// Records taken apart in parameters, with defaults that read earlier parts
function area({ width = 1, height = width, unit: { name = "cm", scale = 1 } = {} } = {}, [left = 0, top = left] = []) {
  return width * height * scale + name + (left + top);
}
function all(width) {
  return [area(), area({ width }), area({ width, height: 2 }, [1]), area({ width, unit: { scale: 10 } }, [1, width])].join(" ");
}
console.log(all(3));
console.log(all(10));
console.log(all(0));
