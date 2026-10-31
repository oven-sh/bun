// Lists of strings parsed from json are printed.
const long = "x".repeat(40);
type Named = { name: string; list: string[] };

function print(name: string, value: unknown) {
  console.log(name, JSON.stringify(Bun.inspect(value)));
}

for (const first of ["a", "é", "中", "😀"]) {
  const list = JSON.stringify([first, long, "o"]);
  const named = JSON.stringify({ name: long + first, list: [first, long, "o"] });
  const escaped = `[${JSON.stringify(first)},"${"\\u0078".repeat(40)}","a\\n${long}","\\u001b[31m${long}","o"]`;
  const bytes = new TextEncoder().encode(list);
  const namedBytes = new TextEncoder().encode(named);

  print("JSON.parse", JSON.parse(list));
  print("as a list of strings", JSON.parse(list) as string[]);
  print("as a record", JSON.parse(named) as Named);
  print("a member of a record", (JSON.parse(named) as Named).list);
  print(
    "with a reviver",
    JSON.parse(list, (_, value) => value),
  );
  print("with escapes", JSON.parse(escaped) as string[]);
  print("twice", [JSON.parse(list), JSON.parse(list)]);
  print(
    "seventeen characters",
    JSON.parse(JSON.stringify([first, "y".repeat(17), "y".repeat(17), "y".repeat(17), "y".repeat(17), "o"])),
  );
  print(
    "sixteen characters",
    JSON.parse(JSON.stringify([first, "y".repeat(16), "y".repeat(16), "y".repeat(16), "y".repeat(16), "o"])),
  );
  print("three hundred characters", JSON.parse(JSON.stringify([first, "z".repeat(300), "o"])));
  print("Response of a text", await new Response(list).json());
  print("Response of bytes", await new Response(bytes).json());
  print("Response as a record", (await new Response(namedBytes).json()) as Named);
  print("Request of bytes", await new Request("http://localhost/", { method: "POST", body: bytes }).json());
  print("Blob of bytes", await new Blob([bytes]).json());
  print("lines of a text", Bun.JSONL.parse(list + "\n" + list + "\n"));
  print("lines of bytes", Bun.JSONL.parse(new TextEncoder().encode(list + "\n" + JSON.stringify([long, long]) + "\n")));
  print("a chunk of bytes", Bun.JSONL.parseChunk(bytes).values);
  print("written", [first, long, "o"]);
}
