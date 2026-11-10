// The bundler of plain Bun's library renames these three ("Cipheriv2", "Decipheriv2", "$"). A compiled program says what is written.
const crypto = require("node:crypto");
console.log(crypto.Cipheriv.name, crypto.Decipheriv.name, JSON.stringify(require("@vercel/fetch").name));
/* Output:
Cipheriv Decipheriv "default"
*/
