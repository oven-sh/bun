interface Row {
  name: string;
  age: number;
}
function parsed(text: string): Row[] {
  const [head, ...lines] = text.split("\n");
  const keys = head.split(",");
  return lines.map(line => {
    const cells = line.split(",");
    return { name: cells[keys.indexOf("name")], age: Number(cells[keys.indexOf("age")]) };
  });
}
const rows = parsed("age,name\n7,ann\n9,bob");
console.log(JSON.stringify(rows), rows[1].age + rows[0].age);
