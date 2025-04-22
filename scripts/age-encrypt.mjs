// Requires npm packages to have been installed in `test`
import { Encrypter } from "../test/node_modules/age-encryption/dist/index.js  ";

const chunks = [];

process.stdin.on("data", chunk => {
  chunks.push(chunk);
});
process.stdin.on("end", async () => {
  const combined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const i in chunks) {
    combined.set(chunks[i], offset);
    offset += chunks[i].length;
    chunks[i] = undefined;
  }
  const e = new Encrypter();
  e.addRecipient("age1eunsrgxwjjpzr48hm0y98cw2vn5zefjagt4r0qj4503jg2nxedqqkmz6fu");
  const ciphertext = await e.encrypt(combined);
  process.stdout.write(ciphertext);
});
