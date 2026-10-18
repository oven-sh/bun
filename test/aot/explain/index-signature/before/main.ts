interface Named {
  name: string;
}

function show(value: Named | Record<string, string>): string | undefined {
  return value.name;
}

console.log(show({ name: "Ada" }), show({ other: "Bo" }));
