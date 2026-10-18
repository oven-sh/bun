interface Named {
  name: string;
}

function nameOf<T extends object>(value: T): string {
  return "name" in value ? String(value.name) : "";
}

const ada: Named = { name: "Ada" };
console.log(nameOf(ada));
