import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "pages");
const name = JSON.parse('"en"');
const ask = async (word, work) => {
  try {
    console.log(word, await work());
  } catch (error) {
    console.log(word, "threw", error.code ?? error.name);
  }
};
const streamed = file =>
  new Promise((resolve, reject) => {
    let text = "";
    fs.createReadStream(file, "utf8")
      .on("data", part => (text += part))
      .on("end", () => resolve(JSON.stringify(text)))
      .on("error", reject);
  });
await ask("loaded", async () => (await import("./pages/" + name + ".json", { with: { type: "json" } })).default.hello);
await ask("required", () => require(path.join(folder, JSON.parse('"note.txt"'))).default ?? "no default");
for (const file of fs.readdirSync(folder).sort()) {
  const whole = path.join(folder, file);
  await ask(file + ": exists, then read", () => (fs.existsSync(whole) ? JSON.stringify(fs.readFileSync(whole, "utf8")) : "the fallback"));
  await ask(file + ": stat, then stream", async () => fs.statSync(whole).size + " " + (await streamed(whole)));
  await ask(file + ": access, then open", () => {
    fs.accessSync(whole, fs.constants.R_OK);
    const descriptor = fs.openSync(whole, "r");
    const bytes = Buffer.alloc(8);
    const count = fs.readSync(descriptor, bytes, 0, 8, 0);
    fs.closeSync(descriptor);
    return count + " " + JSON.stringify(bytes.toString("latin1", 0, count));
  });
  await ask(file + ": promises", async () => (await fs.promises.stat(whole)).size === (await fs.promises.readFile(whole)).length);
  await ask(file + ": Bun.file", async () => [await Bun.file(whole).exists(), Bun.file(whole).size, (await Bun.file(whole).text()).length].join(" "));
}
await ask("absent: exists, then read", () => (fs.existsSync(path.join(folder, "it.json")) ? "found" : "the fallback"));
await ask("absent: stat", () => fs.statSync(path.join(folder, "it.json")).size);
process.exit(0);
