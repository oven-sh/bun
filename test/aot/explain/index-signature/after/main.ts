interface Named {
  name: string;
}

function show(value: Named | Map<string, string>): string | undefined {
  return value instanceof Map ? value.get("name") : value.name;
}

console.log(show({ name: "Ada" }), show(new Map([["other", "Bo"]])));
