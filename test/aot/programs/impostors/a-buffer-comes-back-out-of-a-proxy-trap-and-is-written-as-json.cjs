function show(value) {
  if (Array.isArray(value)) return Array.from(value, item => show(item)).join();
  return JSON.stringify(value);
}
for (const make of [() => ["a", "b"], () => Buffer.from("ab")]) console.log(show(new Proxy(make(), { get: target => target }).anything));
