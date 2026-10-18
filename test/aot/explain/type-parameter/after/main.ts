interface Named {
  name: string;
}

function nameOf(value: Named): string {
  return value.name;
}

const ada: Named = { name: "Ada" };
console.log(nameOf(ada));
