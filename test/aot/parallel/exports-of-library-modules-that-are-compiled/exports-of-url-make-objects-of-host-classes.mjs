import { URL as Address, URLSearchParams as Query, fileURLToPath, pathToFileURL } from "node:url";
const address = new Address("http://localhost/a?b=1");
console.log(address instanceof URL, address.searchParams instanceof Query, address.searchParams.get("b"), `${address}`, JSON.stringify(address));
console.log(pathToFileURL("/tmp/x") instanceof URL, fileURLToPath("file:///tmp/x"), [...new Query("a=1&b=2")].length);
