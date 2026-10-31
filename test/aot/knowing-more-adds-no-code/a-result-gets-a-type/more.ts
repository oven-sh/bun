
type Box = { left: number; top: number; width: number; height: number };
function parse(text: string): Box {
  const parts = text.split(",").map(Number);
  return { left: parts[0], top: parts[1], width: parts[2], height: parts[3] };
}
function area(text: string): number {
  const box = parse(text);
  return box.width * box.height + box.left + box.top;
}
console.log(area(process.argv[2] ?? "1,2,3,4"), area("5,6,7,8"));
