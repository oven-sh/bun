const tell = (found, subject, given) => { try { const answer = Reflect.apply(found, subject, given); console.log(typeof found, typeof answer, String(answer)); } catch (error) { console.log(typeof found, error.name); } };
const bytes = new Uint8Array([1, 2]);
for (const name of ["at", "toLocaleString", "join", "indexOf", "fill"]) {
  let holder = bytes, described;
  while (holder && !(described = Object.getOwnPropertyDescriptor(holder, name))) holder = Object.getPrototypeOf(holder);
  tell(described.value, bytes, [1]);
}
