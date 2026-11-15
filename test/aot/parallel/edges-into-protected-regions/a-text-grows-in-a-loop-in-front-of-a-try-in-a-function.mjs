function main() {
  let note = "";
  let said = "";
  for (let i = 0; i < 4; i++) { said += typeof i + i + " "; }
  try { JSON.parse(process.argv[2] ?? "{}"); } catch (e) { note = e.toString(); }
  console.log(said, note.length);
}
main();
